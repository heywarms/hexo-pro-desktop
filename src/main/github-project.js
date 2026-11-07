'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');
const { normalizeRepository, createSyncService } = require('./hexo-pro-core/sync_service');
const { createCloudSync } = require('./hexo-pro-core/cloud_sync');

function validateConnection(input = {}) {
  const repository = normalizeRepository(input.repository);
  const githubToken = typeof input.githubToken === 'string' ? input.githubToken.trim() : '';
  const branch = typeof input.branch === 'string' ? input.branch.trim() : '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('请输入 GitHub 源码仓库，例如 owner/blog');
  if (!githubToken || githubToken === '******' || !/^[\x21-\x7e]+$/.test(githubToken)) throw new Error('请填写完整的 GitHub 访问凭据');
  if (!branch || branch.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(branch)) throw new Error('请选择或填写有效的源码分支');
  return { repository, githubToken, branch };
}

// Fixed API origin and constructed paths keep credentials away from arbitrary URLs.
async function queryGitHub(input, fetchImpl = globalThis.fetch) {
  const githubToken = typeof input?.githubToken === 'string' ? input.githubToken.trim() : '';
  if (!githubToken || !/^[\x21-\x7e]+$/.test(githubToken)) throw new Error('请先填写 GitHub 访问凭据');
  const page = Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1;
  const request = async resource => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${resource}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Hexo-Pro-Desktop' },
        signal: AbortSignal.timeout(30000), redirect: 'error'
      });
    } catch { throw new Error('无法连接 GitHub，请检查网络后重试'); }
    if (!response.ok) {
      if (response.status === 401) throw new Error('GitHub 访问凭据无效或已过期');
      if (response.status === 403 || response.status === 429) throw new Error('GitHub 暂时拒绝访问，请检查仓库权限或稍后重试');
      if (response.status === 404) throw new Error('找不到仓库，请检查仓库名称和凭据的授权范围');
      throw new Error(`读取 GitHub 失败（${response.status}），请稍后重试`);
    }
    return { data: await response.json(), nextPage: /rel="next"/.test(response.headers.get('link') || '') ? page + 1 : null };
  };
  if (input.action === 'repositories') {
    const result = await request(`/user/repos?sort=updated&per_page=100&page=${page}`);
    return { items: result.data.map(repo => ({ name: repo.full_name, defaultBranch: repo.default_branch, private: Boolean(repo.private) })), nextPage: result.nextPage };
  }
  if (input.action === 'branches') {
    const { repository } = validateConnection({ ...input, branch: 'main' });
    const resource = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`;
    const repo = page === 1 ? (await request(resource)).data : null;
    const result = await request(`${resource}/branches?per_page=100&page=${page}`);
    return { items: result.data.map(branch => ({ name: branch.name })), defaultBranch: repo?.default_branch, nextPage: result.nextPage };
  }
  throw new Error('不支持的仓库查询');
}

async function importGitHubProject(projectPath, input, options = {}) {
  const config = validateConnection(input);
  // mkdir is exclusive: an existing project (even an empty directory) is never replaced.
  await fs.mkdir(projectPath);
  try {
    const cloud = (options.createCloudSync || createCloudSync)(projectPath, options.cloudOptions);
    options.onProgress?.('正在读取 GitHub 源码…');
    const preview = await cloud.preview(config, 'restore');
    options.onProgress?.(`正在恢复 ${preview.downloadCount} 个源文件…`);
    const result = await cloud.apply(config, preview.id);
    const settings = yaml.load(await fs.readFile(path.join(projectPath, '_config.yml'), 'utf8'));
    const source = path.resolve(projectPath, settings?.source_dir || 'source');
    const relative = path.relative(projectPath, source);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('博客 source_dir 必须位于项目内');
    // Git does not store empty folders; an empty blog is still a valid project.
    await fs.mkdir(source, { recursive: true });
    createSyncService(projectPath).saveConfig({ ...config, lastSyncTime: result.lastSyncTime });
    return result;
  } catch (error) {
    await fs.rm(projectPath, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { queryGitHub, validateConnection, importGitHubProject };
