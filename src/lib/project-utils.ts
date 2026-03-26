import { join } from 'path';
import { mkdir, writeFile, access, copyFile, readFile } from 'fs/promises';

import { sanitizeDirName } from './file-utils';

/**
 * Generates a unique, non-colliding absolute directory path for a project name.
 * It will append `-1`, `-2`, etc. if the folder already exists.
 *
 * @param baseDir The parent directory where the project should reside
 * @param projectName The requested name of the project
 * @returns A unique absolute path
 */
export async function getUniqueProjectPath(baseDir: string, projectName: string): Promise<string> {
    const sanitized = sanitizeDirName(projectName) || 'untitled-project';

    let currentPath = join(baseDir, sanitized);
    let counter = 1;
    let isUnique = false;

    while (!isUnique) {
        try {
            // access throws if file/dir DOES NOT exist, which means it's available
            await access(currentPath);
            // If we get here, it means the folder exists, so we need to increment
            currentPath = join(baseDir, `${sanitized}-${counter}`);
            counter++;
        } catch {
            // The path does not exist, so it's unique
            isUnique = true;
        }
    }

    return currentPath;
}

/**
 * Setup default Claude workspace structures for a new project
 *
 * @param projectPath The absolute path of the new project
 * @param projectId Optional project ID used for hook targetPrefix/PROJECT_ID
 */
export async function setupProjectDefaults(
    projectPath: string,
    projectId?: string,
    workspaceRoot: string = process.cwd(),
    options?: { useHookTemplate?: boolean }
): Promise<void> {
    try {
        const resolvedProjectId = projectId || '__PROJECT_ID__';
        const useHookTemplate = options?.useHookTemplate ?? true;
        // 1. Create .claude/hooks and commands directories
        const claudeDir = join(projectPath, '.claude');
        const hooksDir = join(claudeDir, 'hooks');
        const commandsDir = join(claudeDir, 'commands');

        await mkdir(hooksDir, { recursive: true });
        await mkdir(commandsDir, { recursive: true });

        const templateHooksDir = join(workspaceRoot, 'src', 'hooks', 'template');

        // 2. Generate standard CLAUDE.md in .claude directory
        const claudeMdPath = join(claudeDir, 'CLAUDE.md');
        try {
            await access(claudeMdPath);
        } catch {
            try {
                await copyFile(
                    join(templateHooksDir, 'CLAUDE.template.md'),
                    claudeMdPath
                );
            } catch (e) {
                console.error('[project-utils] Failed to copy CLAUDE.template.md', e);
            }
        }

        // 3. Copy hook and settings templates

        if (useHookTemplate) {
            try {
                const pullSyncPath = join(templateHooksDir, 'hooks', 'minio-pull-sync.ts');
                let pullSyncContent = await readFile(pullSyncPath, 'utf-8');
                pullSyncContent = pullSyncContent.replace(/__PROJECT_ID__/g, resolvedProjectId);
                await writeFile(join(hooksDir, 'minio-pull-sync.ts'), pullSyncContent, 'utf-8');

                const pushSyncPath = join(templateHooksDir, 'hooks', 'minio-push-sync.ts');
                let pushSyncContent = await readFile(pushSyncPath, 'utf-8');
                pushSyncContent = pushSyncContent.replace(/__PROJECT_ID__/g, resolvedProjectId);
                await writeFile(join(hooksDir, 'minio-push-sync.ts'), pushSyncContent, 'utf-8');

                await copyFile(
                    join(templateHooksDir, 'settings.json'),
                    join(claudeDir, 'settings.json')
                );
            } catch (e) {
                console.error('[project-utils] Failed to copy hook templates for new project', e);
            }
        }
    } catch (e) {
        console.error('[project-utils] Error setting up project defaults:', e);
    }
}
