#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const readFiles = require('./read_files');
const minimatch = require('minimatch');

const [,, root = process.cwd()] = process.argv;

function getConfig() {
  let config;
  try {
    config = require(path.join(root, 'package.json')).denoc;
    if (!config) {
      throw new Error(`No 'denoc' config found`);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
  return config;
}

function findRoot(paths) {
  if (paths.length === 1) {
    return path.dirname(paths[0]);
  } 
  const tokens = paths.map(p => p.split(path.sep));
  for (let i = 0; i < tokens[0].length; ++i) {
    if (!tokens.slice(1).every(token => token[i] === tokens[0][i])) {
      return path.join(...tokens[0].slice(0, i));
    }
  }
  return path.dirname(paths[0]);
}

function mapDependency(prefix, id, suffix, map, relative) {
  if (map[id].startsWith('http')) {
    return `${prefix}${map[id]}${suffix}`;
  }
  const replacement = path.relative(path.dirname(relative), map[id]);
  return `${prefix}./${replacement}${suffix}`;
}

function reduceLine(lines, line, relative, { exclude, skip = [], map }) {
  const match = line.match(/(^\s*import\s+.*["'])([\w\/\.]+)(["'];?)/);
  if (!match) {
    return [...lines, line];
  }
  const [, prefix, id, suffix] = match;
  if (id.startsWith('.')) {
    const file = path.join(path.dirname(relative), `${id}.ts`);
    if (map[file]) {
      return [...lines, mapDependency(prefix, file, suffix, map, relative)];
    } else if (exclude && exclude.some(pattern => minimatch(file, pattern))) {
      return lines;
    }
    return [...lines, `${prefix}${id}.ts${suffix}`];
  } else if (skip.includes(id)) {
    return lines;
  } else if (map[id]) {
    return [...lines, mapDependency(prefix, id, suffix, map, relative)];
  }
  throw new Error(`Unhandled dependency '${id}', add to "skip" or "map".`);
}

async function denocFile (root, srcRoot, relative, config) {
  const srcFile = path.join(root, relative);
  const dstFile = path.join(root, config.outDir, path.relative(srcRoot, relative));
  const src = await fs.readFile(srcFile, 'utf-8');
  const dst = src.split('\n').reduce((a, b) => reduceLine(a, b, relative, config), []).join('\n');
  await fs.writeFile(dstFile, dst);
}

async function renderFiles(root, files, config) {
  if (!files.length) {
    process.exit(0);
  }
  const srcRoot = findRoot(files);
  await Promise.all(files.map(relative => denocFile(root, srcRoot, relative, config)));
}

async function main() {
  const config = getConfig();

  if (!config.outDir) {
    console.error(`No 'outDir' specified.`);
    process.exit(1);
  }
  await fs.rmdir(config.outDir, { recursive: true });
  await fs.mkdir(config.outDir, { recursive: true });

  if (config.include) {
    if (!Array.isArray(config.include)) {
      console.error(`'include' not an array.`);
      process.exit(1);
    }
    const files = await readFiles(root, config);
    await renderFiles(root, files, config);

  } else if (config.files) {
    if (!Array.isArray(config.files)) {
      console.error(`'files' not an array.`);
      process.exit(1);
    }
    await renderFiles(root, config.files, config);
  } else {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});