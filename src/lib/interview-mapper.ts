// Wire shapes (snake_case, matching DB rows) and conversions to/from
// the camelCase shapes used by the React component in
// src/app/interview/page.tsx. No Supabase imports here so this is safe
// for both client and server consumption.

export interface ResumeFile {
  name: string;
  size: number;
  ext: string;
  storagePath?: string;
}

export interface Memory {
  id: string;
  text: string;
  createdAt: number;
}

export interface TranscriptMsg {
  role: "interviewer" | "candidate";
  text: string;
}

export interface ProposedMemory {
  id: string;
  text: string;
  state: "pending" | "accepted" | "rejected";
  memId?: string;
  // When set, accepting this proposal replaces the existing memory with this
  // id (rather than just adding a new one).
  replacesId?: string;
}

export type InterviewType = "hr" | "hm" | "other";

// ─── Profile ──────────────────────────────────────────────────────────

export interface ProfileRow {
  id: string;
  name: string;
  resume: ResumeFile | null;
  memories: Memory[];
  created_at: string;
  updated_at: string;
}

export interface ProfilePatch {
  name?: string;
  resume?: ResumeFile | null;
  memories?: Memory[];
}

export interface Profile {
  id: string;
  name: string;
  resume: ResumeFile | null;
  memories: Memory[];
  createdAt: number;
}

export function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    resume: row.resume ?? null,
    memories: Array.isArray(row.memories) ? row.memories : [],
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function profilePatchToRow(patch: Partial<Profile>): ProfilePatch {
  const out: ProfilePatch = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.resume !== undefined) out.resume = patch.resume;
  if (patch.memories !== undefined) out.memories = patch.memories;
  return out;
}

// ─── Job ──────────────────────────────────────────────────────────────

export interface JobRow {
  id: string;
  profile_id: string;
  company: string;
  role: string;
  url: string;
  posting: string;
  research: string;
  created_at: string;
  updated_at: string;
}

export interface JobPatch {
  profile_id?: string;
  company?: string;
  role?: string;
  url?: string;
  posting?: string;
  research?: string;
}

export interface Job {
  id: string;
  profileId: string;
  company: string;
  role: string;
  url: string;
  posting: string;
  research: string;
  createdAt: number;
}

export function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    profileId: row.profile_id,
    company: row.company,
    role: row.role,
    url: row.url,
    posting: row.posting,
    research: row.research,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function jobPatchToRow(patch: Partial<Job>): JobPatch {
  const out: JobPatch = {};
  if (patch.profileId !== undefined) out.profile_id = patch.profileId;
  if (patch.company !== undefined) out.company = patch.company;
  if (patch.role !== undefined) out.role = patch.role;
  if (patch.url !== undefined) out.url = patch.url;
  if (patch.posting !== undefined) out.posting = patch.posting;
  if (patch.research !== undefined) out.research = patch.research;
  return out;
}

// ─── Interview ────────────────────────────────────────────────────────

export interface InterviewRow {
  id: string;
  profile_id: string;
  job_id: string;
  type: InterviewType;
  title: string;
  notes: string;
  status: string;
  duration_ms: number;
  questions: number;
  transcript: TranscriptMsg[];
  feedback: string | null;
  proposed_memories: ProposedMemory[] | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewPatch {
  profile_id?: string;
  job_id?: string;
  type?: InterviewType;
  title?: string;
  notes?: string;
  status?: string;
  duration_ms?: number;
  questions?: number;
  transcript?: TranscriptMsg[];
  feedback?: string | null;
  proposed_memories?: ProposedMemory[] | null;
}

export interface InterviewRecord {
  id: string;
  profileId: string;
  jobId: string;
  type: InterviewType;
  title: string;
  notes: string;
  status: string;
  durationMs: number;
  questions: number;
  transcript: TranscriptMsg[];
  feedback: string | null;
  proposedMemories: ProposedMemory[] | null;
  createdAt: number;
}

export function rowToInterview(row: InterviewRow): InterviewRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    jobId: row.job_id,
    type: row.type,
    title: row.title,
    notes: row.notes,
    status: row.status,
    durationMs: row.duration_ms,
    questions: row.questions,
    transcript: Array.isArray(row.transcript) ? row.transcript : [],
    feedback: row.feedback,
    proposedMemories: row.proposed_memories,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function interviewPatchToRow(
  patch: Partial<InterviewRecord>
): InterviewPatch {
  const out: InterviewPatch = {};
  if (patch.profileId !== undefined) out.profile_id = patch.profileId;
  if (patch.jobId !== undefined) out.job_id = patch.jobId;
  if (patch.type !== undefined) out.type = patch.type;
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.durationMs !== undefined) out.duration_ms = patch.durationMs;
  if (patch.questions !== undefined) out.questions = patch.questions;
  if (patch.transcript !== undefined) out.transcript = patch.transcript;
  if (patch.feedback !== undefined) out.feedback = patch.feedback;
  if (patch.proposedMemories !== undefined)
    out.proposed_memories = patch.proposedMemories;
  return out;
}
