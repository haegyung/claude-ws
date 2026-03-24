/**
 * Output formatter — converts Claude message arrays to various output formats
 * (JSON, HTML, Markdown, YAML, custom text extraction)
 */

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: any;
}

interface ClaudeOutput {
  type?: string;
  id?: string;
  message?: {
    role?: string;
    content?: ClaudeContentBlock[];
  };
}

interface FormattedResponse {
  formatted_data: string;
  format: string;
  messages?: ClaudeOutput[];
  status?: string;
  attempt: {
    id: string;
    taskId: string;
    prompt: string;
    status: string;
    createdAt: number;
    completedAt: number | null;
  };
}

/**
 * Convert ClaudeOutput array to requested format
 */
export function formatOutput(
  messages: ClaudeOutput[],
  format: string,
  schema: string | null,
  attemptMetadata: {
    id: string;
    taskId: string;
    prompt: string;
    status: string;
    createdAt: number;
    completedAt: number | null;
  }
): FormattedResponse {
  try {
    let formattedData: string;

    switch (format) {
      case 'html':
        formattedData = toHtml(messages);
        break;
      case 'markdown':
        formattedData = toMarkdown(messages);
        break;
      case 'yaml':
        formattedData = toYaml(messages);
        break;
      case 'raw':
        formattedData = toJson(messages);
        break;
      case 'custom':
        formattedData = extractCustomFormat(messages);
        break;
      case 'json':
      default:
        formattedData = toJson(messages);
        break;
    }

    return {
      formatted_data: formattedData,
      format,
      messages,
      status: attemptMetadata.status as any,
      attempt: { ...attemptMetadata, status: attemptMetadata.status as any }
    };
  } catch {
    return {
      formatted_data: toJson(messages),
      format: 'json',
      messages,
      status: attemptMetadata.status as any,
      attempt: { ...attemptMetadata, status: attemptMetadata.status as any }
    };
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function toHtml(messages: ClaudeOutput[]): string {
  const blocks = messages.map((msg, index) => {
    if (!msg.message?.content) return '';
    return msg.message.content.map((block: ClaudeContentBlock) => {
      switch (block.type) {
        case 'text':
          return `<div class="claude-message-text" data-index="${index}"><p>${escapeHtml(block.text || '')}</p></div>`;
        case 'thinking':
          return `<details class="claude-thinking" data-index="${index}" open><summary style="cursor:pointer;font-weight:bold;margin-bottom:8px;">💭 Thinking</summary><div style="margin-left:16px;font-size:0.9em;color:#666;">${escapeHtml(block.thinking || '')}</div></details>`;
        case 'tool_use': {
          const toolInput = typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2);
          return `<div class="claude-tool-use" data-index="${index}" data-tool="${block.name || 'unknown'}"><div style="background:#f5f5f5;border-left:4px solid #2196F3;padding:12px;margin:8px 0;border-radius:4px;"><strong>🔧 ${block.name || 'Unknown Tool'}</strong><pre style="background:#fff;padding:8px;margin-top:8px;border-radius:4px;overflow-x:auto;"><code>${escapeHtml(toolInput)}</code></pre></div></div>`;
        }
        case 'tool_result':
          return `<div class="claude-tool-result" data-index="${index}"><div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px;margin:8px 0;border-radius:4px;"><strong>📊 Tool Result</strong><pre style="background:#fff;padding:8px;margin-top:8px;border-radius:4px;overflow-x:auto;"><code>${escapeHtml(JSON.stringify(block.input, null, 2))}</code></pre></div></div>`;
        default:
          return `<div class="claude-unknown-block" data-index="${index}"><p>Unknown block type: ${block.type}</p></div>`;
      }
    }).join('\n');
  }).join('\n');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Claude Output</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;max-width:900px;margin:40px auto;padding:20px;background:#f5f5f5}.claude-message-text,.claude-thinking{background:white;padding:16px;margin:12px 0;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}pre{font-family:'Monaco','Menlo','Ubuntu Mono',monospace;font-size:0.875rem}</style></head><body>${blocks}</body></html>`;
}

function toMarkdown(messages: ClaudeOutput[]): string {
  return messages.map((msg, _index) => {
    if (!msg.message?.content) return '';
    return msg.message.content.map((block: ClaudeContentBlock) => {
      switch (block.type) {
        case 'text': return `${block.text || ''}\n`;
        case 'thinking': return `> **💭 Thinking**\n> ${block.thinking || ''}\n`;
        case 'tool_use': {
          const toolInput = typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2);
          return `### 🔧 ${block.name || 'Unknown Tool'}\n\`\`\`\n${toolInput}\n\`\`\`\n`;
        }
        case 'tool_result':
          return `### 📊 Tool Result\n\`\`\`\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n`;
        default: return `> Unknown block type: ${block.type}\n`;
      }
    }).join('\n');
  }).join('\n');
}

function toYaml(messages: ClaudeOutput[]): string {
  const yamlMessages = messages.map((msg, index) => {
    const contentBlocks = msg.message?.content?.map((block: ClaudeContentBlock) => {
      const lines: string[] = [`    - type: ${block.type}`];
      if (block.type === 'text' && block.text) {
        lines.push('      text: |');
        block.text.split('\n').forEach(l => lines.push(`        ${l}`));
      }
      if (block.type === 'thinking' && block.thinking) {
        lines.push('      thinking: |');
        block.thinking.split('\n').forEach(l => lines.push(`        ${l}`));
      }
      if (block.type === 'tool_use') {
        lines.push(`      id: ${block.id || 'null'}`);
        lines.push(`      name: ${block.name || 'unknown'}`);
        if (block.input) lines.push(`      input: ${JSON.stringify(block.input)}`);
      }
      if (block.type === 'tool_result') {
        if (block.id) lines.push(`      tool_use_id: ${block.id}`);
        if (block.input) lines.push(`      content: ${JSON.stringify(block.input)}`);
      }
      return lines.join('\n');
    }) || [];

    return `  - index: ${index}\n    type: ${msg.type}\n    ${msg.id ? `id: ${msg.id}` : ''}\n    ${msg.message?.role ? `role: ${msg.message.role}` : ''}\n    content:\n    ${contentBlocks.join('\n    ')}`;
  }).join('\n');

  return `messages:\n${yamlMessages}`;
}

function toJson(messages: ClaudeOutput[]): string {
  return JSON.stringify(messages, null, 2);
}

function extractCustomFormat(messages: ClaudeOutput[]): string {
  const textBlocks = messages
    .map(msg => msg.message?.content || [])
    .flat()
    .filter((b: ClaudeContentBlock) => b.type === 'text')
    .map((b: ClaudeContentBlock) => b.text || '')
    .join('\n\n');

  if (!textBlocks.trim()) {
    const codeBlocks = messages
      .map(msg => msg.message?.content || [])
      .flat()
      .filter((b: ClaudeContentBlock) => b.type === 'tool_use' || b.type === 'tool_result')
      .map((b: ClaudeContentBlock) => {
        if (b.type === 'tool_use' && b.input) return typeof b.input === 'string' ? b.input : JSON.stringify(b.input, null, 2);
        if (b.type === 'tool_result' && b.input) return JSON.stringify(b.input, null, 2);
        return '';
      })
      .join('\n\n');
    return codeBlocks.trim() || textBlocks;
  }

  return textBlocks.trim() || 'No content available';
}
