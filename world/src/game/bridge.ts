// Shared bridge between React UI and the Phaser town scene.
import { Events } from 'phaser';
import type { Course, Npc } from '../config';

export const input = { x: 0, y: 0, interact: false };

export const bus = new Events.EventEmitter();

export type BusEvents = {
  'hover-building': { course: Course | null; x: number; y: number };
  'enter-building': { course: Course };
  'npc-dialog': { npc: Npc };
  'hint': { text: string | null };
};
