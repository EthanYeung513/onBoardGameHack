// Inside a course building: the course's game, full-screen over the (sleeping) town. The spec is
// validated with its game's schema first; a bad spec shows a "being rebuilt" card, never a crash.
import { useMemo } from 'react';
import { GameShell } from '@/games/core/GameShell';
import { instantiateGame } from '@/games/core/instantiate';
import type { GameResult } from '@/games/core/types';
import { WORLD, type Course } from '../config';

export default function CourseGame({ course, onResult, onExit }: {
  course: Course;
  onResult: (result: GameResult) => void;
  onExit: () => void;
}) {
  const checked = useMemo(() => instantiateGame({ game: course.game, spec: course.spec }), [course]);

  if (!checked.ok) {
    return (
      <div className="course-game rebuild" role="dialog" aria-label={course.name}>
        <div className="sd-panel menu-card">
          <h2>This building is being rebuilt</h2>
          <p className="m-sub">{course.name}</p>
          <p className="rebuild-text">Its course is being refreshed. Check back soon, or explore the rest of town.</p>
          <button className="sd-btn" onClick={onExit} autoFocus>Back to town</button>
        </div>
      </div>
    );
  }

  return (
    <div className="course-game" data-game={checked.game}>
      <GameShell
        game={checked.game}
        spec={checked.spec}
        packId={`${WORLD?.storageNs ?? ''}${course.id}`} // saves are per company, like progress
        packTitle={course.name}
        onComplete={onResult}
        onExit={onExit}
      />
    </div>
  );
}
