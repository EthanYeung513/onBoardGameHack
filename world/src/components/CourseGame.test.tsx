// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { wordMatchSample } from '@/games/word-match/spec';
import type { Course } from '../config';
import CourseGame from './CourseGame';

const course = (over: Partial<Course> = {}): Course => ({
  id: 'words', name: 'Speak Acme', completion: 0, game: 'word-match', spec: wordMatchSample, ...over,
});

describe('CourseGame', () => {
  it('shows the "being rebuilt" card for a spec its game rejects, and leaves back to town', () => {
    const onExit = vi.fn();
    render(<CourseGame course={course({ spec: { title: 'Broken', pairs: [] } })} onResult={vi.fn()} onExit={onExit} />);
    expect(screen.getByRole('heading', { name: 'This building is being rebuilt' })).toBeInTheDocument();
    expect(screen.queryByTestId('game-menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to town' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('treats an unknown game or a missing spec the same way', () => {
    render(<CourseGame course={course({ game: 'pinball' as Course['game'] })} onResult={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'This building is being rebuilt' })).toBeInTheDocument();
    cleanup();
    render(<CourseGame course={course({ spec: null })} onResult={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'This building is being rebuilt' })).toBeInTheDocument();
  });

  it("opens a valid course on its game's menu, titled with the course name, with a way back to town", () => {
    const onExit = vi.fn();
    render(<CourseGame course={course()} onResult={vi.fn()} onExit={onExit} />);
    expect(screen.getByTestId('game-menu')).toHaveTextContent('Speak Acme');
    fireEvent.click(screen.getByRole('button', { name: /Leave the building/ }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});
