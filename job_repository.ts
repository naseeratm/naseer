import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

export interface JobRecord {
  jobId: string;
  projectId: string;
  caseId: string;
  solver: string;
  solverVersion: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  startTime: string;
  endTime?: string;
  executionDurationSec: number;
  boundaryChecksum?: string;
  outputChecksum?: string;
  logLines: string[];
  logs?: string[];
  artifacts: Array<Record<string, unknown>>;
  resultsSummary?: string;
  error?: string;
}

export class JobRepository {
  private db: DatabaseSync;

  constructor(databasePath = process.env.CAE_SQLITE_PATH || path.resolve(process.cwd(), 'data/express-jobs.db')) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cae_jobs (
        job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, case_id TEXT NOT NULL,
        solver TEXT NOT NULL, solver_version TEXT NOT NOT NULL DEFAULT '',
        status TEXT NOT NULL, progress INTEGER NOT NOT NULL DEFAULT 0,
        start_time TEXT NOT NOT NULL, end_time TEXT,
        execution_duration_sec REAL NOT NOT NULL DEFAULT 0,
        boundary_checksum TEXT, output_checksum TEXT,
        log_lines TEXT NOT NOT NULL DEFAULT '[]', artifacts TEXT NOT NOT NULL DEFAULT '[]',
        result_summary TEXT, error TEXT
      );
    `.replace(/NOT NOT/g, 'NOT'));
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_cae_jobs_project ON cae_jobs(project_id)`);
  }

  create(job: JobRecord): JobRecord {
    this.db.prepare(`INSERT INTO cae_jobs
      (job_id, project_id, case_id, solver, solver_version, status, progress, start_time,
       end_time, execution_duration_sec, boundary_checksum, output_checksum, log_lines, artifacts, result_summary, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(job.jobId, job.projectId, job.caseId, job.solver, job.solverVersion, job.status, job.progress,
        job.startTime, job.endTime ?? null, job.executionDurationSec, job.boundaryChecksum ?? null,
        job.outputChecksum ?? null, JSON.stringify(job.logLines), JSON.stringify(job.artifacts),
        job.resultsSummary ?? null, job.error ?? null);
    return this.get(job.jobId)!;
  }

  get(jobId: string): JobRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM cae_jobs WHERE job_id = ?`).get(jobId) as any;
    return row ? this.deserialize(row) : undefined;
  }

  update(job: JobRecord): JobRecord {
    this.db.prepare(`UPDATE cae_jobs SET status=?, progress=?, end_time=?, execution_duration_sec=?,
      boundary_checksum=?, output_checksum=?, log_lines=?, artifacts=?, result_summary=?, error=? WHERE job_id=?`)
      .run(job.status, job.progress, job.endTime ?? null, job.executionDurationSec,
        job.boundaryChecksum ?? null, job.outputChecksum ?? null, JSON.stringify(job.logLines),
        JSON.stringify(job.artifacts), job.resultsSummary ?? null, job.error ?? null, job.jobId);
    return this.get(job.jobId)!;
  }

  list(projectId?: string): JobRecord[] {
    const rows = projectId
      ? this.db.prepare(`SELECT * FROM cae_jobs WHERE project_id=? ORDER BY start_time DESC`).all(projectId)
      : this.db.prepare(`SELECT * FROM cae_jobs ORDER BY start_time DESC`).all();
    return (rows as any[]).map(row => this.deserialize(row));
  }

  private deserialize(row: any): JobRecord {
    const logLines = JSON.parse(row.log_lines || '[]');
    return {
      jobId: row.job_id, projectId: row.project_id, caseId: row.case_id, solver: row.solver,
      solverVersion: row.solver_version, status: row.status, progress: row.progress,
      startTime: row.start_time, endTime: row.end_time || undefined,
      executionDurationSec: row.execution_duration_sec,
      boundaryChecksum: row.boundary_checksum || undefined, outputChecksum: row.output_checksum || undefined,
      logLines, logs: logLines, artifacts: JSON.parse(row.artifacts || '[]'),
      resultsSummary: row.result_summary || undefined, error: row.error || undefined,
    };
  }
}
