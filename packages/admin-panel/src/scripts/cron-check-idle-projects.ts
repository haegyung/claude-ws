#!/usr/bin/env tsx
/**
 * Cron Job: Check Idle Projects
 * Schedule: 0 2 * * * (2 AM daily)
 * Description: Stops projects that have been inactive for 24+ hours
 */

import { db } from '@/lib/db';
import { poolProjects } from '@/lib/db/schema';
import { containerPoolManager } from '@/lib/container-pool-manager';
import { lt } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('Cron-CheckIdleProjects');

async function checkIdleProjects() {
  log.info('Starting idle project check...');

  const idleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

  try {
    // Find projects that are running but inactive
    const idleProjects = await db.query.poolProjects.findMany({
      where: lt(poolProjects.lastActivityAt, idleThreshold),
    });

    log.info(`Found ${idleProjects.length} idle projects`);

    for (const project of idleProjects) {
      if (!project.containerId) continue;

      try {
        const lastActivityAt = new Date(project.lastActivityAt);
        const idleDuration = Math.floor((Date.now() - lastActivityAt.getTime()) / 1000 / 60);
        log.info(`Stopping idle project: ${project.name} (${project.id})`);
        log.info(`  Last activity: ${lastActivityAt.toISOString()}`);
        log.info(`  Idle for: ${idleDuration} minutes`);

        await containerPoolManager.releaseContainer(project.containerId, project.id);

        log.info(`✅ Successfully stopped idle project: ${project.name}`);
      } catch (error) {
        log.error(`❌ Failed to stop project ${project.id}:`, String(error));
      }
    }

    log.info('Idle project check completed successfully');
  } catch (error) {
    log.error('Failed to check idle projects:', String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  checkIdleProjects()
    .then(() => {
      log.info('✅ Idle check completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      log.error('❌ Idle check failed:', error);
      process.exit(1);
    });
}

export { checkIdleProjects };
