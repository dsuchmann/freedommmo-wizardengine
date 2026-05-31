export class ProceduralAtlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.cell = 32;
    this.canvas.width = this.cell * 8;
    this.canvas.height = this.cell * 6;
    this.ctx = this.canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    this.frames = new Map();
    this.build();
  }

  build() {
    this.drawGrassBladeSet('grass_sway', 0, '#3f8a34', '#79c45b');
    this.drawGrassBladeSet('mystic_grass_sway', 1, '#49d6c5', '#8a5bd6');
    this.drawFlowerSet('wildflowers', 2);
    this.drawRockSet('boulder_cluster', 3);
    this.drawTreeSet('broadleaf_tree', 4, '#12391f', '#6b4928');
    this.drawTreeSet('mystic_tree', 5, '#2c1b57', '#49d6c5');
  }

  frame(id, frame = 0) {
    const row = this.frames.get(id) ?? 0;
    return { image: this.canvas, sx: (frame % 8) * this.cell, sy: row * this.cell, sw: this.cell, sh: this.cell };
  }

  drawGrassBladeSet(id, row, dark, light) {
    this.frames.set(id, row);
    for (let f = 0; f < 8; f++) {
      const x = f * this.cell;
      const sway = Math.sin((f / 8) * Math.PI * 2) * 4;
      this.ctx.strokeStyle = dark;
      this.ctx.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const bx = x + 4 + i * 3;
        const by = row * this.cell + 28 - (i % 3);
        this.ctx.beginPath();
        this.ctx.moveTo(bx, by);
        this.ctx.quadraticCurveTo(bx + sway, by - 8, bx + sway * 0.5, by - 16 - (i % 4));
        this.ctx.stroke();
      }
      this.ctx.strokeStyle = light;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x + 10, row * this.cell + 27);
      this.ctx.lineTo(x + 10 + sway, row * this.cell + 13);
      this.ctx.stroke();
    }
  }

  drawFlowerSet(id, row) {
    this.frames.set(id, row);
    const colors = ['#ffd6f2', '#fff06a', '#8af7ff', '#ff9d6a'];
    for (let f = 0; f < 8; f++) {
      const x = f * this.cell;
      for (let i = 0; i < 5; i++) {
        this.ctx.fillStyle = '#3f8a34';
        this.ctx.fillRect(x + 7 + i * 4, row * this.cell + 18, 1, 8);
        this.ctx.fillStyle = colors[(f + i) % colors.length];
        this.ctx.fillRect(x + 6 + i * 4, row * this.cell + 16, 3, 3);
      }
    }
  }

  drawRockSet(id, row) {
    this.frames.set(id, row);
    for (let f = 0; f < 8; f++) {
      const x = f * this.cell;
      this.ctx.fillStyle = '#42464b';
      this.ctx.fillRect(x + 7, row * this.cell + 15, 18, 11);
      this.ctx.fillStyle = '#777d83';
      this.ctx.fillRect(x + 9, row * this.cell + 13, 12, 5);
      this.ctx.fillStyle = '#2b2d30';
      this.ctx.fillRect(x + 12 + (f % 3), row * this.cell + 19, 10, 1);
    }
  }

  drawTreeSet(id, row, leaf, trunk) {
    this.frames.set(id, row);
    for (let f = 0; f < 8; f++) {
      const x = f * this.cell;
      const sway = Math.sin((f / 8) * Math.PI * 2) * 2;
      this.ctx.fillStyle = 'rgba(0,0,0,.22)';
      this.ctx.fillRect(x + 8, row * this.cell + 25, 18, 4);
      this.ctx.fillStyle = trunk;
      this.ctx.fillRect(x + 14, row * this.cell + 16, 5, 12);
      this.ctx.fillStyle = leaf;
      this.ctx.beginPath();
      this.ctx.arc(x + 16 + sway, row * this.cell + 12, 11, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = id === 'mystic_tree' ? 'rgba(120,255,235,.65)' : 'rgba(125,185,90,.45)';
      this.ctx.fillRect(x + 12 + sway, row * this.cell + 6, 3, 3);
      this.ctx.fillRect(x + 20 + sway, row * this.cell + 13, 2, 2);
    }
  }
}
