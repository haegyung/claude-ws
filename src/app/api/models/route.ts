import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  modelIdToDisplayName,
  Model,
} from '@/lib/models';
import { createLogger } from '@/lib/logger';
import { findClaudePath } from '@/lib/cli-query';

const log = createLogger('Models');

const SELECTED_MODEL_KEY = 'selectedModel';

/**
 * Check if Claude CLI binary is available
 */
function isClaudeCLIAvailable(): boolean {
  return !!findClaudePath();
}

/**
 * Build model list from process.env or fallback to SDK defaults
 */
function buildModelList(): Model[] {
  const hasCustomAuth = !!process.env.ANTHROPIC_AUTH_TOKEN;
  const cliAvailable = isClaudeCLIAvailable();

  // Start with SDK models from environment variables if configured
  const envModels: Model[] = [];

  if (hasCustomAuth) {
    const envEntries: { value: string | undefined; envName: string }[] = [
      { value: process.env.ANTHROPIC_MODEL, envName: 'ANTHROPIC_MODEL' },
      { value: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL, envName: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
      { value: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL, envName: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
      { value: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, envName: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
    ];

    for (const { value, envName } of envEntries) {
      if (value && !envModels.some((m) => m.id === value)) {
        const tier = value.toLowerCase().includes('opus')
          ? 'opus'
          : value.toLowerCase().includes('haiku')
            ? 'haiku'
            : 'sonnet';

        // Infer group from env var name
        const group = envName.startsWith('ANTHROPIC_DEFAULT_')
          ? 'Anthropic'
          : undefined;

        envModels.push({
          id: value,
          name: modelIdToDisplayName(value),
          tier,
          group,
          provider: 'claude-sdk' as const,
        });
      }
    }
  }

  // Build final model list
  const models: Model[] = [];

  // Only add CLI models if Claude CLI binary is available
  if (cliAvailable) {
    models.push(...AVAILABLE_MODELS);
  }

  // Add SDK models if configured
  if (envModels.length > 0) {
    models.push(...envModels);
  }

  return models;
}

/**
 * Get current model from process.env or default
 */
function getCurrentModel(): { modelId: string; source: 'env' | 'cached' | 'default' } {
  const hasCustomAuth = !!process.env.ANTHROPIC_AUTH_TOKEN;

  if (hasCustomAuth) {
    const envModel = process.env.ANTHROPIC_MODEL;
    if (envModel) {
      return { modelId: envModel, source: 'env' };
    }

    // Check tier-specific env vars
    const tierVars = [
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    ];

    for (const value of tierVars) {
      if (value) {
        return { modelId: value, source: 'env' };
      }
    }
  }

  // Will be handled in GET handler (async db lookup)
  return { modelId: DEFAULT_MODEL_ID, source: 'default' };
}

// GET /api/models - List available models and current selection
export async function GET() {
  try {
    const models = buildModelList();
    let currentModelId = DEFAULT_MODEL_ID;
    let source: 'env' | 'cached' | 'default' = 'default';

    // Check ENV first (sync)
    const envResult = getCurrentModel();
    if (envResult.source === 'env') {
      currentModelId = envResult.modelId;
      source = 'env';
    } else {
      // Check cached from db
      const cached = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, SELECTED_MODEL_KEY))
        .limit(1);

      if (cached.length > 0 && cached[0].value) {
        currentModelId = cached[0].value;
        source = 'cached';
      }
    }

    // Derive currentProvider from the model's provider field in the list
    const currentModelDef = models.find(m => m.id === currentModelId);
    let currentProvider = currentModelDef?.provider;

    // If no provider found, determine default based on available models
    if (!currentProvider) {
      // Check if CLI models are available
      const hasCliModels = models.some(m => m.provider === 'claude-cli' || !m.provider);
      currentProvider = hasCliModels ? 'claude-cli' : 'claude-sdk';
    }

    // If current model is no longer available (e.g., CLI model but CLI not installed),
    // fall back to first available model
    if (!currentModelDef && models.length > 0) {
      currentModelId = models[0].id;
      // Update provider to match the fallback model
      currentProvider = models[0].provider || (isClaudeCLIAvailable() ? 'claude-cli' : 'claude-sdk');
      source = 'default';
    }

    return NextResponse.json({
      models,
      current: currentModelId,
      currentProvider,
      source,
    });
  } catch (error) {
    log.error({ error }, 'Error fetching models');
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}

// POST /api/models - Set current model
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { model } = body;

    if (!model || typeof model !== 'string') {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }

    // Save to app_settings (upsert) - accept any model ID
    await db
      .insert(appSettings)
      .values({ key: SELECTED_MODEL_KEY, value: model, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: model, updatedAt: Date.now() },
      });

    return NextResponse.json({ success: true, model });
  } catch (error) {
    log.error({ error }, 'Error saving model');
    return NextResponse.json({ error: 'Failed to save model' }, { status: 500 });
  }
}
