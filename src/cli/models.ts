import { deleteLocalModel, pullLocalModel } from '../localModels.js';
import { formatBytes } from './format.js';

export interface ModelsPullArgs {
  modelId?: string;
  json?: boolean;
}

export interface ModelsDeleteArgs {
  modelId?: string;
  json?: boolean;
}

export async function runModelsPull(args: ModelsPullArgs): Promise<number> {
  if (!args.modelId) {
    console.error('vq models pull requires a model id, e.g. vq models pull mlx-community/Qwen3-4B-4bit');
    return 1;
  }

  try {
    const result = await pullLocalModel(args.modelId);
    if (args.json) {
      console.log(JSON.stringify({ id: result.id, sizeBytes: result.sizeBytes }, null, 2));
    } else {
      console.log(`Pulled ${result.id} (${formatBytes(result.sizeBytes)})`);
    }
    return 0;
  } catch (err) {
    const message = (err as Error).message;
    if (args.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(message);
    }
    return 1;
  }
}

export async function runModelsDelete(args: ModelsDeleteArgs): Promise<number> {
  if (!args.modelId) {
    console.error('vq models delete requires a model id, e.g. vq models delete mlx-community/Qwen3-4B-4bit');
    return 1;
  }

  try {
    const result = await deleteLocalModel(args.modelId);
    if (args.json) {
      console.log(JSON.stringify({ id: result.id, freedBytes: result.freedBytes }, null, 2));
    } else {
      console.log(`Deleted ${result.id}, freed ${formatBytes(result.freedBytes)}`);
    }
    return 0;
  } catch (err) {
    const message = (err as Error).message;
    if (args.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(message);
    }
    return 1;
  }
}
