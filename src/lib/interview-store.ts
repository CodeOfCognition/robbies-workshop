import {
  type Profile,
  type Job,
  type InterviewRecord,
  profilePatchToRow,
  jobPatchToRow,
  interviewPatchToRow,
} from "./interview-mapper";

// Client-side store for the Interview applet. All calls go through the
// /api/interview/* routes, which are gated by the global NextAuth
// middleware and backed by Supabase.

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// ─── Profiles ─────────────────────────────────────────────────────────

export async function listProfiles(): Promise<Profile[]> {
  const res = await fetch("/api/interview/profiles", { cache: "no-store" });
  return parseOrThrow<Profile[]>(res);
}

export async function getProfile(id: string): Promise<Profile> {
  const res = await fetch(
    `/api/interview/profiles/${encodeURIComponent(id)}`,
    { cache: "no-store" }
  );
  return parseOrThrow<Profile>(res);
}

export async function createProfile(
  initial: Partial<Profile> = {}
): Promise<Profile> {
  const body = profilePatchToRow(initial);
  const res = await fetch("/api/interview/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOrThrow<Profile>(res);
}

export async function updateProfile(
  id: string,
  patch: Partial<Profile>
): Promise<Profile> {
  const body = profilePatchToRow(patch);
  const res = await fetch(
    `/api/interview/profiles/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return parseOrThrow<Profile>(res);
}

export async function deleteProfile(id: string): Promise<void> {
  const res = await fetch(
    `/api/interview/profiles/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  await parseOrThrow<{ ok: true }>(res);
}

export async function uploadResume(
  profileId: string,
  file: File
): Promise<Profile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `/api/interview/profiles/${encodeURIComponent(profileId)}/resume`,
    { method: "POST", body: form }
  );
  return parseOrThrow<Profile>(res);
}

export async function deleteResume(profileId: string): Promise<Profile> {
  const res = await fetch(
    `/api/interview/profiles/${encodeURIComponent(profileId)}/resume`,
    { method: "DELETE" }
  );
  return parseOrThrow<Profile>(res);
}

export async function getResumeSignedUrl(profileId: string): Promise<string> {
  const res = await fetch(
    `/api/interview/profiles/${encodeURIComponent(profileId)}/resume`,
    { cache: "no-store" }
  );
  const body = await parseOrThrow<{ url: string }>(res);
  return body.url;
}

// ─── Jobs ─────────────────────────────────────────────────────────────

export async function listJobs(profileId?: string): Promise<Job[]> {
  const url = profileId
    ? `/api/interview/jobs?profile_id=${encodeURIComponent(profileId)}`
    : "/api/interview/jobs";
  const res = await fetch(url, { cache: "no-store" });
  return parseOrThrow<Job[]>(res);
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`/api/interview/jobs/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return parseOrThrow<Job>(res);
}

export async function createJob(
  initial: Partial<Job> & { profileId: string }
): Promise<Job> {
  const body = jobPatchToRow(initial);
  const res = await fetch("/api/interview/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOrThrow<Job>(res);
}

export async function updateJob(
  id: string,
  patch: Partial<Job>
): Promise<Job> {
  const body = jobPatchToRow(patch);
  const res = await fetch(`/api/interview/jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOrThrow<Job>(res);
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`/api/interview/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseOrThrow<{ ok: true }>(res);
}

// ─── Interviews ───────────────────────────────────────────────────────

export async function listInterviews(
  profileId?: string
): Promise<InterviewRecord[]> {
  const url = profileId
    ? `/api/interview/interviews?profile_id=${encodeURIComponent(profileId)}`
    : "/api/interview/interviews";
  const res = await fetch(url, { cache: "no-store" });
  return parseOrThrow<InterviewRecord[]>(res);
}

export async function getInterview(id: string): Promise<InterviewRecord> {
  const res = await fetch(
    `/api/interview/interviews/${encodeURIComponent(id)}`,
    { cache: "no-store" }
  );
  return parseOrThrow<InterviewRecord>(res);
}

export async function createInterview(
  initial: Partial<InterviewRecord> & {
    profileId: string;
    jobId: string;
    type: InterviewRecord["type"];
  }
): Promise<InterviewRecord> {
  const body = interviewPatchToRow(initial);
  const res = await fetch("/api/interview/interviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseOrThrow<InterviewRecord>(res);
}

export async function updateInterview(
  id: string,
  patch: Partial<InterviewRecord>
): Promise<InterviewRecord> {
  const body = interviewPatchToRow(patch);
  const res = await fetch(
    `/api/interview/interviews/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return parseOrThrow<InterviewRecord>(res);
}

export async function deleteInterview(id: string): Promise<void> {
  const res = await fetch(
    `/api/interview/interviews/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  await parseOrThrow<{ ok: true }>(res);
}
