export const PLATE_PLANNING_STRATEGIES = ['balanced', 'user-priority', 'oldest-first', 'utilization', 'height-first'] as const

export type PlatePlanningStrategy = (typeof PLATE_PLANNING_STRATEGIES)[number]

export const BALANCED_PLANNING_WEIGHTS = {
  userPriority: 0.35,
  utilization: 0.4,
  heightCompatibility: 0.25,
} as const
