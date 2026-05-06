import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const layoutTemplate = readFileSync(
  join(process.cwd(), 'src/views/_layout.html'),
  'utf-8',
);

export const render = (title: string, content: string): string =>
  layoutTemplate.replace('{{TITLE}}', title).replace('{{CONTENT}}', content);

export const view = (relativePath: string): string =>
  readFileSync(join(process.cwd(), 'src/views', relativePath), 'utf-8');

export const fillTemplate = (
  template: string,
  vars: Record<string, string>,
): string => {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
};
