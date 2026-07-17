import type { PlatePlanningStrategy } from '../core/platePlanner'

export const PLANNING_OPTIONS: { value: PlatePlanningStrategy; label: string; description: string }[] = [
  { value: 'balanced', label: 'Balanced', description: 'Balance user priority, plate utilization, and resin height compatibility.' },
  { value: 'user-priority', label: 'User priority', description: "Work through every requester's personal queue as fairly as possible." },
  { value: 'oldest-first', label: 'Oldest first', description: 'Process the longest-waiting requests before newer work.' },
  {
    value: 'utilization',
    label: 'Maximum utilization',
    description: 'Prefer the fewest, fullest plates regardless of requester priority.',
  },
  { value: 'largest-first', label: 'Largest first', description: 'Start with the models that occupy the most build-plate area.' },
  { value: 'height-first', label: 'Height first', description: 'Prioritize taller models and compatible resin height bands.' },
]
