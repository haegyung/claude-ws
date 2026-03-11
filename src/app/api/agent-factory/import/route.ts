import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createAgentFactoryService } from '@agentic-sdk/services/agent-factory-plugin-registry-service';
import { createAgentFactoryImportService, ImportError } from '@agentic-sdk/services/agent-factory-component-import-service';

const agentFactoryService = createAgentFactoryService(db);
const importService = createAgentFactoryImportService(db, agentFactoryService);

// POST /api/agent-factory/import - Import component to agent-factory directory
export async function POST(request: NextRequest) {
  try {
    if (!verifyApiKey(request)) return unauthorizedResponse();

    const body = await request.json();
    const { type, name, description, sourcePath, metadata } = body;

    if (!type || !name || !sourcePath) {
      return NextResponse.json({ error: 'Missing required fields: type, name, sourcePath' }, { status: 400 });
    }

    const component = await importService.importComponent({ type, name, description, sourcePath, metadata });
    return NextResponse.json({ component }, { status: 201 });
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error importing component:', error);
    return NextResponse.json({ error: 'Failed to import component' }, { status: 500 });
  }
}
