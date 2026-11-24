import { AgentAvailability, SupportAgent, SupportGroup, Ticket } from '../types/helpdesk';

export type QueueSaturationLevel = 'normal' | 'elevated' | 'saturated';

export interface GroupQueueSaturation {
  group: SupportGroup;
  openCount: number;
  resolvedCount: number;
  agentActiveLoad: number;
  currentVolume: number;
  historicalCapacity: number;
  saturationPct: number;
  excessPct: number;
  level: QueueSaturationLevel;
  availableAgentsCount: number;
  totalAgentsCount: number;
}

const SUPPORT_GROUPS: SupportGroup[] = [
  'N1 Accès & Comptes',
  'N2 Plateforme',
  'N3 Infrastructure',
  'Relation Client & CTI',
];

const AVAILABILITY_CAPACITY_FACTOR: Record<AgentAvailability, number> = {
  available: 1,
  on_call: 0.95,
  busy: 0.65,
  in_call: 0.65,
  off_duty: 0.2,
};

export function computeGroupQueueSaturation(
  tickets: Ticket[],
  agents: SupportAgent[]
): GroupQueueSaturation[] {
  const results = SUPPORT_GROUPS.map((group) => {
    const groupTickets = tickets.filter((t) => t.assignedGroup === group);
    const openCount = groupTickets.filter(
      (t) => t.status !== 'resolved' && t.status !== 'closed'
    ).length;
    const resolvedCount = groupTickets.length - openCount;

    const groupAgents = agents.filter((a) => a.group === group);
    const totalAgentsCount = groupAgents.length;
    const availableAgentsCount = groupAgents.filter(
      (a) => a.availability === 'available' || a.availability === 'on_call'
    ).length;

    const agentActiveLoad = groupAgents.reduce((sum, a) => sum + (a.activeTickets || 0), 0);
    const effectiveMaxCap = groupAgents.reduce((sum, a) => {
      const max = Math.max(1, a.maxConcurrentTickets || 6);
      const factor = AVAILABILITY_CAPACITY_FACTOR[a.availability] ?? 0.7;
      return sum + max * factor;
    }, 0);

    // Historical baseline capacity (~70% of effective steady-state concurrent capacity, plus resolved throughput signal)
    const fallbackBase = totalAgentsCount > 0 ? effectiveMaxCap : 8;
    const historicalCapacity = Math.max(
      3,
      Math.round(fallbackBase * 0.7 + Math.min(2, resolvedCount * 0.25))
    );

    const currentVolume = openCount + agentActiveLoad;
    const saturationPct = Math.round((currentVolume / historicalCapacity) * 100);
    const excessPct = saturationPct - 100;

    let level: QueueSaturationLevel = 'normal';
    if (saturationPct >= 120) {
      level = 'saturated';
    } else if (saturationPct >= 90) {
      level = 'elevated';
    }

    return {
      group,
      openCount,
      resolvedCount,
      agentActiveLoad,
      currentVolume,
      historicalCapacity,
      saturationPct,
      excessPct,
      level,
      availableAgentsCount,
      totalAgentsCount,
    };
  });

  return results.sort((a, b) => {
    if (b.saturationPct !== a.saturationPct) return b.saturationPct - a.saturationPct;
    return b.currentVolume - a.currentVolume;
  });
}
