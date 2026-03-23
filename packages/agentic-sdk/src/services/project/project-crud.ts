/**
 * Project CRUD service - list, get, create, update, delete projects in SQLite via Drizzle ORM.
 * Also handles project directory setup (mkdir, CLAUDE.md) and settings file I/O.
 */
import { eq, desc } from 'drizzle-orm';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import * as schema from '../../db/database-schema';
import { generateId } from '../../lib/nanoid-id-generator';

const SETTINGS_FILE = 'project-settings.json';
const CLAUDE_MD_TEMPLATE = `# CLAUDE.md\n\nThis file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.\n\n<!-- TODO: Update this file once the project is scaffolded with actual build commands, architecture, and conventions. -->\n`;

export interface ProjectSettings {
  selectedComponents: string[];
  selectedAgentSets: string[];
}

/** Typed error for project constraint violations */
export class ProjectValidationError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

export function createProjectService(db: any) {
  return {
    async list() {
      return db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).all();
    },

    async getById(id: string) {
      return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    },

    async getByPath(path: string) {
      return db.select().from(schema.projects).where(eq(schema.projects.path, path)).get();
    },

    async create(data: { id?: string; name: string; path: string }) {
      const id = data.id || generateId('proj');
      const project = { id, name: data.name, path: data.path, createdAt: Date.now() };
      await db.insert(schema.projects).values(project);
      return project;
    },

    async update(id: string, data: Partial<{ name: string; path: string }>) {
      // Build selective update — only include provided fields
      const updateData: any = {};
      if (data.name) updateData.name = data.name;
      if (data.path) updateData.path = data.path;

      const result = await db.update(schema.projects).set(updateData).where(eq(schema.projects.id, id));
      // result.changes === 0 means project not found
      if (result.changes === 0) return null;
      return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    },

    async remove(id: string) {
      const result = await db.delete(schema.projects).where(eq(schema.projects.id, id));
      return result.changes > 0;
    },

    /** Create project directory and generate CLAUDE.md if missing */
    async setupProjectDirectory(projectPath: string) {
      try {
        await mkdir(projectPath, { recursive: true });
      } catch (err: any) {
        if (err?.code !== 'EEXIST') throw err;
      }
      const claudeMdPath = join(projectPath, 'CLAUDE.md');
      try {
        await access(claudeMdPath);
      } catch {
        await writeFile(claudeMdPath, CLAUDE_MD_TEMPLATE, 'utf-8');
      }
    },

    /** Read project settings from .claude/project-settings.json */
    readSettings(projectPath: string): ProjectSettings | null {
      const settingsPath = join(projectPath, '.claude', SETTINGS_FILE);
      if (!existsSync(settingsPath)) return null;
      try {
        return JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        return null;
      }
    },

    /** Write project settings to .claude/project-settings.json */
    writeSettings(projectPath: string, settings: ProjectSettings) {
      const claudeDir = join(projectPath, '.claude');
      if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, SETTINGS_FILE), JSON.stringify(settings, null, 2), 'utf-8');
    },

    /** Validate + setup directory + create project. Throws ProjectValidationError on constraint violation. */
    async createProject(data: { id?: string; name: string; path: string }) {
      if (!data.name || !data.path) throw new ProjectValidationError('Name and path are required', 400);
      try {
        await this.setupProjectDirectory(data.path);
        return await this.create(data);
      } catch (error: any) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ProjectValidationError('A project with this path already exists', 409);
        }
        throw error;
      }
    },

    /** Validate + update project. Throws ProjectValidationError on constraint violation or not found. */
    async updateProject(id: string, data: Partial<{ name: string; path: string }>) {
      if (!data.name && !data.path) throw new ProjectValidationError('At least one field (name or path) is required', 400);
      try {
        const result = await this.update(id, data);
        if (!result) throw new ProjectValidationError('Project not found', 404);
        return result;
      } catch (error: any) {
        if (error instanceof ProjectValidationError) throw error;
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ProjectValidationError('A project with this path already exists', 409);
        }
        throw error;
      }
    },

    /** Delete project by ID. Throws ProjectValidationError if not found. */
    async deleteProject(id: string) {
      const removed = await this.remove(id);
      if (!removed) throw new ProjectValidationError('Project not found', 404);
    },

    /** Get settings by project ID. Throws ProjectValidationError if project not found. */
    async getSettingsByProjectId(id: string) {
      const project = await this.getById(id);
      if (!project) throw new ProjectValidationError('Project not found', 404);
      const settings = this.readSettings(project.path);
      if (!settings) throw new ProjectValidationError('Settings not found', 404);
      return settings;
    },

    /** Update settings by project ID with normalization. Throws ProjectValidationError if project not found. */
    async updateSettingsByProjectId(id: string, settings: any) {
      const project = await this.getById(id);
      if (!project) throw new ProjectValidationError('Project not found', 404);
      if (!settings) throw new ProjectValidationError('Missing settings in request body', 400);
      const normalized: ProjectSettings = {
        selectedComponents: settings.selectedComponents || [],
        selectedAgentSets: settings.selectedAgentSets || [],
      };
      this.writeSettings(project.path, normalized);
      return normalized;
    },
  };
}
