/**
 * Agent Factory archive extraction service - extracts zip, tar, and gzip archives
 */
import { unlink } from 'fs/promises';
import { join } from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

export async function extractZip(filePath: string, targetDir: string): Promise<void> {
  const zip = new AdmZip(filePath);
  zip.extractAllTo(targetDir, true);
}

export async function extractTar(filePath: string, targetDir: string, gzipped: boolean): Promise<void> {
  await tar.x({ file: filePath, cwd: targetDir, gzip: gzipped });
}

export async function extractGzip(filePath: string, targetDir: string): Promise<void> {
  const baseName = filePath.replace(/\.gz$|\.gzip$/i, '');
  const outputPath = join(targetDir, baseName.split('/').pop() || 'file');

  return new Promise<void>((resolve, reject) => {
    const decompressor = createGunzip();
    const input = createReadStream(filePath);
    const output = createWriteStream(outputPath);

    decompressor.on('error', reject);
    output.on('error', reject);
    output.on('finish', async () => {
      if (baseName.endsWith('.tar')) {
        await extractTar(outputPath, targetDir, false);
        await unlink(outputPath);
      }
      resolve();
    });

    pipeline(input, decompressor, output).catch(reject);
  });
}

/** Extract archive based on file extension */
export async function extractArchive(filePath: string, targetDir: string, fileName: string): Promise<void> {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.zip')) {
    await extractZip(filePath, targetDir);
  } else if (lowerName.endsWith('.tar') || lowerName.endsWith('.tgz')) {
    await extractTar(filePath, targetDir, lowerName.endsWith('.tgz'));
  } else if (lowerName.endsWith('.gz') || lowerName.endsWith('.gzip')) {
    await extractGzip(filePath, targetDir);
  }
}
