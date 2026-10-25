/** A speaker glyph for the games' mute toggles: drawn, not an emoji, so it renders on devices without an emoji font. */
export function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block" }}>
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />}
    </svg>
  );
}
