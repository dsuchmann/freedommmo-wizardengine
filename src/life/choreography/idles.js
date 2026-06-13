// src/life/choreography/idles.js — Idle loop programs that play when no
// performance is active. Subtle breathing, weight shifts, glances.
// These are layered in parallel by the motion-player idle system.

export const IDLE_PROGRAMS = [
  {
    id: 'idle_breathe', weight: 1.0,
    root: { op: 'sequence', children: [
      { op: 'pose', joints: { spine: 2 }, ticks: 15 },
      { op: 'pose', joints: { spine: -1 }, ticks: 15 },
      { op: 'pose', joints: { spine: 0 }, ticks: 10 },
    ]},
  },
  {
    id: 'idle_weight_shift', weight: 0.3,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 30 },
      { op: 'pose', joints: { thigh_l: -5, thigh_r: 3 }, ticks: 8 },
      { op: 'wait', ticks: 20 },
      { op: 'pose', joints: { thigh_l: 3, thigh_r: -5 }, ticks: 8 },
      { op: 'wait', ticks: 20 },
      { op: 'pose', joints: { thigh_l: 0, thigh_r: 0 }, ticks: 6 },
    ]},
  },
  {
    id: 'idle_glance_left', weight: 0.15,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 50 },
      { op: 'pose', joints: { head: -25 }, ticks: 4 },
      { op: 'wait', ticks: 12 },
      { op: 'pose', joints: { head: 0 }, ticks: 4 },
    ]},
  },
  {
    id: 'idle_glance_right', weight: 0.15,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 60 },
      { op: 'pose', joints: { head: 25 }, ticks: 4 },
      { op: 'wait', ticks: 10 },
      { op: 'pose', joints: { head: 0 }, ticks: 4 },
    ]},
  },
  {
    id: 'idle_arm_adjust', weight: 0.2,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 40 },
      { op: 'pose', joints: { arm_u_r: 15, arm_f_r: 20 }, ticks: 5 },
      { op: 'wait', ticks: 8 },
      { op: 'pose', joints: { arm_u_r: 0, arm_f_r: 0 }, ticks: 5 },
    ]},
  },
  {
    id: 'idle_sway', weight: 0.1,
    root: { op: 'sequence', children: [
      { op: 'pose', joints: { spine: 3 }, ticks: 20 },
      { op: 'pose', joints: { spine: -3 }, ticks: 20 },
      { op: 'pose', joints: { spine: 0 }, ticks: 15 },
    ]},
  },
  {
    id: 'idle_foot_tap', weight: 0.1,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 70 },
      { op: 'pose', joints: { foot_r: -15 }, ticks: 2 },
      { op: 'pose', joints: { foot_r: 0 }, ticks: 2 },
      { op: 'pose', joints: { foot_r: -15 }, ticks: 2 },
      { op: 'pose', joints: { foot_r: 0 }, ticks: 2 },
    ]},
  },
  {
    id: 'idle_shoulder_roll', weight: 0.1,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 45 },
      { op: 'pose', joints: { arm_u_l: -20, arm_u_r: 20 }, ticks: 4 },
      { op: 'pose', joints: { arm_u_l: -10, arm_u_r: 10 }, ticks: 3 },
      { op: 'pose', joints: { arm_u_l: 0, arm_u_r: 0 }, ticks: 4 },
    ]},
  },
  {
    id: 'idle_stretch', weight: 0.05,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 80 },
      { op: 'pose', joints: { arm_u_l: -100, arm_u_r: 100, spine: 5 }, ticks: 6 },
      { op: 'wait', ticks: 10 },
      { op: 'pose', joints: { arm_u_l: 0, arm_u_r: 0, spine: 0 }, ticks: 6 },
    ]},
  },
  {
    id: 'idle_head_tilt', weight: 0.15,
    root: { op: 'sequence', children: [
      { op: 'wait', ticks: 35 },
      { op: 'pose', joints: { head: -15, spine: 2 }, ticks: 5 },
      { op: 'wait', ticks: 15 },
      { op: 'pose', joints: { head: 0, spine: 0 }, ticks: 4 },
    ]},
  },
];
