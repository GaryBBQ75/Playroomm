// Persistance simple des crews (classement de saison, historique) dans un fichier JSON.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'crews.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = { crews: {} };
    }
    this.timer = null;
  }

  get(code) { return this.data.crews[code] || null; }

  create(code, name) {
    const rec = { code, name, createdAt: Date.now(), season: {}, history: [] };
    this.data.crews[code] = rec;
    this.save();
    return rec;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const tmp = this.file + '.tmp';
      fs.writeFile(tmp, JSON.stringify(this.data), err => {
        if (err) { console.error('Sauvegarde impossible', err); return; }
        fs.rename(tmp, this.file, e => e && console.error('Sauvegarde impossible', e));
      });
    }, 1500);
  }

  flushSync() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}
