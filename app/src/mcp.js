import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { folderName, isYoutubeProfile, profileId, profileLabel } from './settings.js';

function asList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.profiles)) return data.profiles;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function readText(result) {
  const block = result?.content?.find((item) => item.type === 'text');
  const raw = block?.text ?? '';
  if (result?.isError) throw new Error(raw || 'Ошибка MCP');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createMcp() {
  let client = null;
  let transport = null;
  let stderr = '';

  async function disconnect() {
    const current = client;
    client = null;
    transport = null;
    if (!current) return;
    try {
      await current.close();
    } catch {
      // The child process may already be gone.
    }
  }

  async function connect(config) {
    await disconnect();
    stderr = '';
    const mcpPath = path.resolve(config.mcpPath);
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpPath],
      cwd: path.dirname(mcpPath),
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
        SHARDX_API: config.api,
        SHARDX_TOKEN: config.token,
      },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    client = new Client({ name: 'youtube-serfer', version: '1.0.0' });
    try {
      await client.connect(transport);
    } catch (error) {
      const detail = stderr.trim();
      await disconnect();
      throw new Error(detail ? `${error.message}\n${detail}` : error.message);
    }
  }

  function connected() {
    return Boolean(client);
  }

  async function call(name, args = {}) {
    if (!client) throw new Error('Нет подключения к MCP');
    const result = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 180000 },
    );
    return readText(result);
  }

  async function listProfiles() {
    const data = await call('list_profiles');
    return asList(data)
      .filter(isYoutubeProfile)
      .map((profile) => ({
        id: profileId(profile),
        name: profileLabel(profile),
        folder: folderName(profile),
      }))
      .filter((profile) => profile.id);
  }

  return { connect, disconnect, connected, call, listProfiles };
}
