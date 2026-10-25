import type { PackExtraction } from "./batch";
import type { PendingChunk } from "./extract";

// Streaming extraction pool for seed_brain: passages are added as soon as triage labels them;
// packs start as soon as they fill (the very first pack of a run is small, so the first facts
// commit within seconds), up to `inFlight` model calls at once, and each finished call is
// committed right away, one commit at a time, in the order calls finish. Serial commits keep
// entity resolution exact (a pack resolves against everything committed before it), so entities
// never duplicate. A failed call stops new launches; every call that did finish is still
// committed before the error is rethrown, so a retry never re-pays it.

export interface PoolOptions {
  inFlight: number;
  firstPack: number;
  packSize: number;
  /** Character budget per call. */
  maxChars: number;
  /** Launch a new call only while this returns true (time budget, lost lease). */
  canLaunch: () => boolean;
  extract: (pack: PendingChunk[]) => Promise<PackExtraction>;
  commit: (pack: PendingChunk[], extraction: PackExtraction) => Promise<void>;
}

export class PackPool {
  private buffer: PendingChunk[] = [];
  private running = 0;
  private launched = 0;
  private commits: Promise<void> = Promise.resolve();
  private error: unknown = null;
  private commitFailed = false;
  private calls = new Set<Promise<void>>();
  /** True once a launch was refused (budget/lease): the caller pauses. */
  stopped = false;

  constructor(private readonly o: PoolOptions) {}

  /** Queue passages; full packs start immediately when a slot is free. */
  add(chunks: PendingChunk[]) {
    this.buffer.push(...chunks);
    this.pump(false);
  }

  /** Passages queued but not yet sent to the model. */
  get queued() {
    return this.buffer.length;
  }

  private nextSize() {
    return this.launched === 0 ? this.o.firstPack : this.o.packSize;
  }

  private takePack(): PendingChunk[] {
    const size = this.nextSize();
    const pack: PendingChunk[] = [];
    let chars = 0;
    while (this.buffer.length && pack.length < size && (!pack.length || chars + this.buffer[0].text.length <= this.o.maxChars)) {
      const c = this.buffer.shift()!;
      chars += c.text.length;
      pack.push(c);
    }
    return pack;
  }

  private pump(flush: boolean) {
    while (!this.error && !this.stopped && this.running < this.o.inFlight && this.buffer.length && (flush || this.buffer.length >= this.nextSize())) {
      if (!this.o.canLaunch()) {
        this.stopped = true;
        return;
      }
      const pack = this.takePack();
      this.launched++;
      this.running++;
      const call = this.o
        .extract(pack)
        .then(
          (extraction) => {
            // Commit in finish order, one at a time; a commit failure is the pool's error too.
            // After a failed commit the database state is uncertain: stop committing.
            this.commits = this.commits.then(() => (this.commitFailed ? undefined : this.o.commit(pack, extraction))).catch((err) => {
              this.commitFailed = true;
              this.error ??= err;
            });
          },
          (err) => {
            this.error ??= err;
          },
        )
        .finally(() => {
          this.running--;
          this.calls.delete(call);
          this.pump(this.flushing);
        });
      this.calls.add(call);
    }
  }

  private flushing = false;

  /** Send every queued passage (partial packs too), wait for all calls and commits. */
  async drain(): Promise<void> {
    this.flushing = true;
    this.pump(true);
    while (this.calls.size) {
      await Promise.race(this.calls);
      this.pump(true);
    }
    await this.commits;
    this.flushing = false;
    if (this.error) throw this.error;
  }
}
