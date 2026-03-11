/**
 * Chat history search service - full-text search across attempt prompts and assistant logs
 */
import { eq, like, or, and, inArray } from 'drizzle-orm';
import * as schema from '../db/database-schema.ts';

/** Extract a snippet of text around the matched query (~80 chars of context) */
function extractMatchSnippet(text: string, queryLower: string): string | null {
  const textLower = text.toLowerCase();
  const matchIndex = textLower.indexOf(queryLower);
  if (matchIndex === -1) return null;

  const contextChars = 40;
  const start = Math.max(0, matchIndex - contextChars);
  const end = Math.min(text.length, matchIndex + queryLower.length + contextChars);
  let snippet = text.substring(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet.replace(/\s+/g, ' ');
}

export function createChatHistorySearchService(db: any) {
  return {
    async searchChatHistory(query: string, opts?: { projectId?: string; projectIds?: string[] }) {
      const projectIdList: string[] = [];
      if (opts?.projectIds?.length) projectIdList.push(...opts.projectIds);
      else if (opts?.projectId) projectIdList.push(opts.projectId);

      // Get tasks for project(s)
      let tasksResult;
      if (projectIdList.length > 0) {
        tasksResult = await db.select({ id: schema.tasks.id, projectId: schema.tasks.projectId })
          .from(schema.tasks).where(inArray(schema.tasks.projectId, projectIdList)).all();
      } else {
        tasksResult = await db.select({ id: schema.tasks.id, projectId: schema.tasks.projectId })
          .from(schema.tasks).all();
      }

      const taskIds = tasksResult.map((t: any) => t.id);
      if (taskIds.length === 0) return [];

      const taskMatchMap = new Map<string, any>();
      const queryLower = query.toLowerCase();

      // Search in attempt prompts
      const promptMatches = await db.select({
        id: schema.attempts.id,
        taskId: schema.attempts.taskId,
        prompt: schema.attempts.prompt,
        displayPrompt: schema.attempts.displayPrompt,
      }).from(schema.attempts)
        .where(and(
          inArray(schema.attempts.taskId, taskIds),
          or(
            like(schema.attempts.prompt, `%${query}%`),
            like(schema.attempts.displayPrompt, `%${query}%`)
          )
        )).limit(50).all();

      for (const attempt of promptMatches) {
        if (taskMatchMap.has(attempt.taskId)) continue;
        const searchText = attempt.displayPrompt || attempt.prompt;
        const snippet = extractMatchSnippet(searchText, queryLower);
        if (snippet) {
          taskMatchMap.set(attempt.taskId, {
            taskId: attempt.taskId, matchedText: snippet, source: 'prompt', attemptId: attempt.id,
          });
        }
      }

      // Search in attempt logs (assistant responses)
      const attemptIds = await db.select({ id: schema.attempts.id, taskId: schema.attempts.taskId })
        .from(schema.attempts).where(inArray(schema.attempts.taskId, taskIds)).all();
      const attemptToTask = new Map<string, string>(attemptIds.map((a: any) => [a.id as string, a.taskId as string]));
      const allAttemptIds = attemptIds.map((a: any) => a.id);

      if (allAttemptIds.length > 0) {
        const logMatches = await db.select({
          id: schema.attemptLogs.id,
          attemptId: schema.attemptLogs.attemptId,
          content: schema.attemptLogs.content,
        }).from(schema.attemptLogs)
          .where(and(
            inArray(schema.attemptLogs.attemptId, allAttemptIds),
            eq(schema.attemptLogs.type, 'json'),
            like(schema.attemptLogs.content, `%${query}%`)
          )).limit(100).all();

        for (const log of logMatches) {
          const taskId = attemptToTask.get(log.attemptId);
          if (!taskId || taskMatchMap.has(taskId)) continue;
          try {
            const parsed = JSON.parse(log.content);
            let textContent = '';
            if (parsed.type === 'assistant' && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === 'text' && block.text) textContent += block.text + ' ';
              }
            }
            if (textContent) {
              const snippet = extractMatchSnippet(textContent, queryLower);
              if (snippet) {
                taskMatchMap.set(taskId, {
                  taskId, matchedText: snippet, source: 'assistant', attemptId: log.attemptId,
                });
              }
            }
          } catch { /* skip invalid JSON */ }
        }
      }

      return Array.from(taskMatchMap.values());
    },
  };
}
