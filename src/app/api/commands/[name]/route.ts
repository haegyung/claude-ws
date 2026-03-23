import { NextRequest, NextResponse } from 'next/server';
import { createCommandService } from '@agentic-sdk/services/command/slash-command-listing';

const commandService = createCommandService();

interface CommandParams {
  params: Promise<{ name: string }>;
}

// GET /api/commands/[name] - Get command info by name
export async function GET(request: NextRequest, { params }: CommandParams) {
  try {
    const { name } = await params;
    const projectPath = request.nextUrl.searchParams.get('projectPath') || undefined;

    const result = commandService.getById(name, projectPath);
    if (!result) {
      return NextResponse.json({ error: 'Command not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to get command:', error);
    return NextResponse.json({ error: 'Failed to get command' }, { status: 500 });
  }
}

// POST /api/commands/[name] - Process command with $ARGUMENTS substitution, return expanded prompt
export async function POST(request: NextRequest, { params }: CommandParams) {
  try {
    const { name } = await params;
    const body = await request.json();
    const { arguments: args, subcommand } = body;

    const result = commandService.processPrompt(name, args, subcommand);
    if ('code' in result) {
      const status = result.code === 'FORBIDDEN' ? 403 : 404;
      return NextResponse.json({ error: result.code === 'FORBIDDEN' ? 'Invalid command path' : 'Command not found' }, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to process command:', error);
    return NextResponse.json({ error: 'Failed to process command' }, { status: 500 });
  }
}
