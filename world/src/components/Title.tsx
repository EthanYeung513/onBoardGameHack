import { COMPANY } from '../config';

export default function Title({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="title-screen">
      <img className="title-logo" src="assets/logo.png" alt={COMPANY.name} />
      <div className="title-tag">{COMPANY.tagline}</div>
      <button className="sd-btn title-play" onClick={onPlay} autoFocus>
        ▶&nbsp; Play
      </button>
      <div className="title-credit">new-hire world · day one</div>
    </div>
  );
}
