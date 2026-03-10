/**
 * Agent Output Handler - Output format prompt building and file reading
 *
 * Extracted from agent-manager.ts. Handles output format instructions
 * that get appended to prompts, and reading custom output files after completion.
 */

import { resolve } from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('AgentOutputHandler');

/**
 * Check if command is a server/dev command that should run in background
 */
export function isServerCommand(command: string): boolean {
  const patterns = [
    /npm\s+run\s+(dev|start|serve)/i,
    /yarn\s+(dev|start|serve)/i,
    /pnpm\s+(dev|start|serve)/i,
    /npx\s+(directus|strapi|next|vite|nuxt)/i,
    /nohup\s+/i,
  ];
  return patterns.some(p => p.test(command));
}

/**
 * Build output format instructions to append to prompt
 */
export function buildOutputFormatPrompt(outputFormat: string, outputSchema?: string, attemptId?: string): string {
  const dataDir = process.env.DATA_DIR || process.cwd();
  const outputFilePath = resolve(dataDir, 'tmp', attemptId || 'unknown');

  const example = getOutputFormatExample(outputFormat);

  let prompt = `\n\n=== REQUIRED OUTPUT ===\nYou MUST write your WORK RESULTS to a ${outputFormat.toUpperCase()} file at: ${outputFilePath}.${outputFormat}`;
  if (outputSchema) prompt += `\n\nFormat:\n${outputSchema}`;
  prompt += `\n\nCRITICAL INSTRUCTIONS:
1. Use Write tool with PARAMETER 1 (file path) and PARAMETER 2 (your content)
2. DO NOT wrap content in metadata like {"file_path": ..., "content": ...}
3. The file should contain ONLY the actual ${outputFormat.toUpperCase()} data
4. MANDATORY: After writing, you MUST use Read tool to verify the file was written correctly
5. If the file content is invalid, fix it and rewrite

${example}

Your task is INCOMPLETE until:\n1. File exists with valid content\n2. You have Read it back to verify\n========================`;

  return prompt;
}

/**
 * Get format-specific example text for output instructions
 */
function getOutputFormatExample(outputFormat: string): string {
  switch (outputFormat.toLowerCase()) {
    case 'json': return `Example: Write:\n["Max", "Bella", "Charlie"]\n\nNOT:\n{Max, Bella, Charlie} (unquoted strings - invalid JSON)\nNOT:\n{"file_path":"...", "content":["Max"]} (don't wrap in metadata)`;
    case 'yaml': case 'yml': return `Example: Write:\n- Max\n- Bella\n- Charlie\n\nNOT:\n["Max", "Bella", "Charlie"] (that's JSON, not YAML)`;
    case 'html': case 'htm': return `Example: Write:\n<div class="container">\n  <h1>Results</h1>\n</div>\n\nNOT:\n{"html": "<div>..."} (don't wrap in metadata)`;
    case 'css': return `Example: Write:\n.container { color: red; }\n\nNOT:\n{"css": ".container {...}"} (don't wrap in metadata)`;
    case 'js': return `Example: Write:\nconst result = ["Max", "Bella"];\nconsole.log(result);\n\nNOT:\n{"javascript": "const..."} (don't wrap in metadata)`;
    case 'md': case 'markdown': return `Example: Write:\n# Results\n\n- Max\n- Bella\n- Charlie\n\nNOT:\n{"markdown": "# Results"} (don't wrap in metadata)`;
    case 'csv': return `Example: Write:\nMax,Bella,Charlie\n\nNOT:\n["Max","Bella","Charlie"] (that's JSON, not CSV)`;
    case 'tsv': return `Example: Write:\nMax\tBella\tCharlie\n\nNOT:\n["Max","Bella","Charlie"] (that's JSON, not TSV)`;
    case 'txt': return `Example: Write:\nMax\nBella\nCharlie\n\nNOT:\n{"content": "Max\\nBella"} (don't wrap in metadata)`;
    case 'xml': return `Example: Write:\n<?xml version="1.0"?>\n<root>\n  <item>Max</item>\n</root>\n\nNOT:\n{"xml": "<?xml...>"} (don't wrap in metadata)`;
    default: return `Example: Write the actual ${outputFormat.toUpperCase()} content directly, not wrapped in any metadata or JSON object.`;
  }
}

/** Emitter interface expected by readOutputFile */
export interface OutputFileEmitter {
  emit(event: string, data: unknown): boolean;
}

/**
 * Read custom output file after completion and emit result
 */
export function readOutputFile(emitter: OutputFileEmitter, attemptId: string, outputFormat: string): void {
  try {
    const fs = require('fs');
    const dataDir = process.env.DATA_DIR || process.cwd();
    const outputFilePath = resolve(dataDir, 'tmp', `${attemptId}.${outputFormat}`);

    if (fs.existsSync(outputFilePath)) {
      const fileContent = fs.readFileSync(outputFilePath, 'utf-8');
      emitter.emit('json', {
        attemptId,
        data: {
          type: 'result',
          subtype: 'success',
          is_error: false,
          content: fileContent,
          outputFormat,
        },
      });
    } else {
      emitter.emit('stderr', { attemptId, content: `Error: Expected output file not found: ${outputFilePath}` });
    }
  } catch (readError) {
    log.error({ err: readError }, 'Failed to read output file');
  }
}
