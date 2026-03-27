import { access, copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Setup default Claude workspace structures for a new project.
 */
export async function setupProjectDefaults(
  projectPath: string,
  projectId: string,
  workspaceRoot: string = process.cwd()
): Promise<void> {
  const claudeDir = join(projectPath, '.claude');
  const hooksDir = join(claudeDir, 'hooks');
  const commandsDir = join(claudeDir, 'commands');
  const templateHooksDir = join(workspaceRoot, 'src', 'hooks', 'template');

  await mkdir(hooksDir, { recursive: true });
  await mkdir(commandsDir, { recursive: true });

  const claudeMdPath = join(claudeDir, 'CLAUDE.md');
  try {
    await access(claudeMdPath);
  } catch {
    await copyFile(join(templateHooksDir, 'CLAUDE.template.md'), claudeMdPath);
  }

  const pullSyncPath = join(templateHooksDir, 'hooks', 'minio-pull-sync.ts');
  const pushSyncPath = join(templateHooksDir, 'hooks', 'minio-push-sync.ts');

  const pullSyncContent = (await readFile(pullSyncPath, 'utf-8')).replace(/__PROJECT_ID__/g, projectId);
  const pushSyncContent = (await readFile(pushSyncPath, 'utf-8')).replace(/__PROJECT_ID__/g, projectId);

  await writeFile(join(hooksDir, 'minio-pull-sync.ts'), pullSyncContent, 'utf-8');
  await writeFile(join(hooksDir, 'minio-push-sync.ts'), pushSyncContent, 'utf-8');
  await copyFile(join(templateHooksDir, 'settings.json'), join(claudeDir, 'settings.json'));

  const envPath = join(hooksDir, '.env');
  try {
    await access(envPath);
  } catch {
    const apiBase = process.env.API_HOOK_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || '8052'}`;
    await writeFile(envPath, `API_HOOK_URL="${apiBase}"\n`, 'utf-8');
  }
}
