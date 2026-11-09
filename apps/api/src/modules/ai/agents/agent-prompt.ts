/** Penyusun system prompt agent pribadi (Subordinate). */

export interface AgentProfile {
  id: string;
  name: string;
  description: string | null;
  instruction: string;
  responsibilities: string | null;
  boundaries: string | null;
  memory: string | null;
}

export interface SkillContent {
  name: string;
  description: string;
  instructions: string;
}

export const AGENT_LIMITS = {
  maxSkillChars: 8000,
  maxSkillsTotalChars: 24000,
  maxProfileFieldChars: 6000,
} as const;

function clip(value: string | null | undefined, max: number): string {
  const text = (value ?? '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * System prompt agent: identitas dan tanggung jawab, cara kerja, batasan, memori,
 * skill yang dipasang, lalu aturan umum (bahasa, kejujuran, konektor, persetujuan).
 */
export function buildAgentPrompt(
  agent: AgentProfile,
  skills: SkillContent[],
  context: { ownerName: string; today: string; groupNote?: string },
): string {
  const sections: string[] = [
    `Anda adalah "${agent.name}", agent digital (Subordinate) milik ${context.ownerName} di ContributorAI.`,
  ];
  const role = clip(agent.responsibilities || agent.description, AGENT_LIMITS.maxProfileFieldChars);
  if (role) sections.push(`## Tanggung jawab\n${role}`);
  const instruction = clip(agent.instruction, AGENT_LIMITS.maxProfileFieldChars);
  if (instruction) sections.push(`## Cara kerja\n${instruction}`);
  const boundaries = clip(agent.boundaries, AGENT_LIMITS.maxProfileFieldChars);
  if (boundaries) sections.push(`## Batasan (wajib dipatuhi)\n${boundaries}`);
  const memory = clip(agent.memory, AGENT_LIMITS.maxProfileFieldChars);
  if (memory) sections.push(`## Memori dan preferensi jangka panjang\n${memory}`);

  let budget: number = AGENT_LIMITS.maxSkillsTotalChars;
  const skillBlocks: string[] = [];
  for (const skill of skills) {
    if (budget <= 0) break;
    const body = clip(skill.instructions, Math.min(AGENT_LIMITS.maxSkillChars, budget));
    budget -= body.length;
    skillBlocks.push(`### ${skill.name}\n_${clip(skill.description, 500)}_\n${body}`);
  }
  if (skillBlocks.length > 0) {
    sections.push(
      `## Skill yang Anda kuasai\nGunakan skill yang relevan dengan tugas.\n\n${skillBlocks.join('\n\n')}`,
    );
  }
  if (context.groupNote) sections.push(`## Kerja tim\n${context.groupNote}`);

  sections.push(
    [
      '## Aturan umum',
      '- Jawab dalam Bahasa Indonesia yang jelas dan profesional.',
      '- Kerjakan tugas sampai tuntas; serahkan hasil akhir terstruktur dalam Markdown.',
      '- Jangan mengarang data. Bila butuh data, gunakan tool konektor yang tersedia; bila tidak ada, katakan terus terang.',
      '- Operasi yang mengubah data selalu menunggu persetujuan manusia; jelaskan tujuan dan dampaknya.',
      '- Bila instruksi ambigu atau informasi penting kurang, panggil tool minta_klarifikasi daripada menebak.',
      `- Tanggal hari ini: ${context.today}.`,
    ].join('\n'),
  );
  return sections.join('\n\n');
}
