import { readFileSync } from 'node:fs';

const categories = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const version = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
const releaseHeading = new RegExp(`^## \\[(${version})\\] - (\\d{4}-\\d{2}-\\d{2})(?: \\[YANKED\\])?$`);
const repository = 'https://github.com/mikimatsub/swsd-mcp';

/** Validate the repository's Keep a Changelog 1.1.0 conventions without network access. */
export function checkChangelog(text) {
  const errors = [];
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const header = lines.slice(0, lines.findIndex((line) => line.startsWith('## '))).join('\n');
  if (lines[0] !== '# Changelog') errors.push('Start with # Changelog.');
  if (!header.includes('[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)') ||
      !header.includes('[Semantic Versioning](https://semver.org/spec/v2.0.0.html)')) {
    errors.push('Declare Keep a Changelog 1.1.0 and Semantic Versioning adherence in the header.');
  }

  const releases = [];
  const references = new Map();
  let section;
  let category;
  let inReferences = false;
  const fail = (index, message) => errors.push(`Line ${index + 1}: ${message}`);
  const finishCategory = () => {
    if (category && !category.content) errors.push(`Empty ${category.name} category in ${section.version}.`);
  };

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const reference = /^\[([^\]]+)\]: (https:\/\/\S+)$/.exec(line);
    if (reference) {
      inReferences = true;
      const key = reference[1].toLowerCase();
      if (references.has(key)) fail(index, `Duplicate link reference: ${key}.`);
      references.set(key, reference[2]);
      continue;
    }
    if (inReferences) {
      fail(index, 'Only link references may appear in the bottom reference block.');
      continue;
    }
    if (line.startsWith('## ')) {
      finishCategory();
      const match = releaseHeading.exec(line);
      if (line !== '## [Unreleased]' && !match) {
        fail(index, 'Use ## [X.Y.Z] - YYYY-MM-DD with an optional [YANKED] suffix.');
      }
      section = { version: match?.[1] ?? 'Unreleased', date: match?.[2], categories: [] };
      if (releases.some((release) => release.version === section.version)) fail(index, 'Duplicate release heading.');
      if (!releases.length && line !== '## [Unreleased]') fail(index, 'Put ## [Unreleased] first.');
      if (releases.length && line === '## [Unreleased]') fail(index, 'Unreleased must appear only at the top.');
      if (section.date) {
        const parsed = new Date(`${section.date}T00:00:00Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== section.date) {
          fail(index, 'Use a real calendar date.');
        }
        const previous = releases.at(-1);
        if (previous?.date && previous.date < section.date) fail(index, 'Release dates must be reverse chronological.');
        if (previous?.date) {
          const currentParts = section.version.split('.').map(BigInt);
          const previousParts = previous.version.split('.').map(BigInt);
          const differing = currentParts.findIndex((part, partIndex) => part !== previousParts[partIndex]);
          if (differing < 0 || currentParts[differing] > previousParts[differing]) {
            fail(index, 'Release versions must be strictly descending.');
          }
        }
      }
      releases.push(section);
      category = undefined;
    } else if (line.startsWith('### ')) {
      finishCategory();
      const name = line.slice(4);
      const position = categories.indexOf(name);
      if (!section || position < 0) {
        fail(index, `Use only these categories under a release: ${categories.join(', ')}.`);
        category = undefined;
        continue;
      }
      if (position <= categories.indexOf(section.categories.at(-1))) fail(index, 'Categories must be unique and in the required order.');
      section.categories.push(name);
      category = { name, content: false };
    } else if (/^#+\s/.test(line) && index !== 0) {
      fail(index, 'Use only the title, release headings, and category headings.');
    } else if (section) {
      if (!category) fail(index, 'Put release content under a change category.');
      else category.content = true;
    }
  }
  finishCategory();
  if (releases[0]?.version !== 'Unreleased') errors.push('Missing ## [Unreleased].');
  if (releases.length < 2) errors.push('Include at least one dated release.');
  for (const [index, release] of releases.entries()) {
    if (release.date && !release.categories.length) errors.push(`Missing change categories in ${release.version}.`);
    const older = releases[index + 1];
    const expected = index === 0
      ? `${repository}/compare/v${older?.version}...HEAD`
      : older
        ? `${repository}/compare/v${older.version}...v${release.version}`
        : `${repository}/releases/tag/v${release.version}`;
    if (references.get(release.version.toLowerCase()) !== expected) {
      errors.push(`Missing or incorrect bottom link for [${release.version}]: expected ${expected}.`);
    }
  }
  for (const key of references.keys()) {
    if (!releases.some((release) => release.version.toLowerCase() === key)) errors.push(`Link reference [${key}] has no release heading.`);
  }
  return errors;
}

if (import.meta.main) {
  const errors = checkChangelog(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('CHANGELOG.md follows Keep a Changelog 1.1.0.');
  }
}
