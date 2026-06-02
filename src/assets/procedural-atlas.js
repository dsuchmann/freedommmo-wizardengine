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
    this.drawTreeSet('broadleaf_tree', 4, '#356640', '#6b4928');
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
        const bx = x + 7 + i * 4;
        const by = row * this.cell + 26;
        this.ctx.strokeStyle = '#3f8a34';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(bx, by);
        this.ctx.quadraticCurveTo(bx + Math.sin(f + i) * 2, by - 5, bx + 1, by - 9);
        this.ctx.stroke();
        this.ctx.fillStyle = colors[(f + i) % colors.length];
        this.ctx.beginPath();
        this.ctx.arc(bx + 1, by - 10, 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  drawRockSet(id, row) {
    this.frames.set(id, row);
    for (let f = 0; f < 8; f++) {
      const x = f * this.cell;
      const baseY = row * this.cell;
      this.ctx.fillStyle = 'rgba(70,74,72,.24)';
      this.ctx.beginPath();
      this.ctx.ellipse(x + 16, baseY + 26, 10, 3, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = '#42464b';
      this.ctx.beginPath();
      this.ctx.moveTo(x + 6, baseY + 24);
      this.ctx.lineTo(x + 9, baseY + 16);
      this.ctx.lineTo(x + 15, baseY + 12);
      this.ctx.lineTo(x + 24, baseY + 15);
      this.ctx.lineTo(x + 27, baseY + 23);
      this.ctx.quadraticCurveTo(x + 17, baseY + 28, x + 6, baseY + 24);
      this.ctx.fill();
      this.ctx.fillStyle = '#777d83';
      this.ctx.beginPath();
      this.ctx.moveTo(x + 11, baseY + 16);
      this.ctx.lineTo(x + 16, baseY + 13);
      this.ctx.lineTo(x + 22, baseY + 16);
      this.ctx.lineTo(x + 15, baseY + 18);
      this.ctx.fill();
      this.ctx.strokeStyle = '#555b5d';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x + 12 + (f % 3), baseY + 20);
      this.ctx.lineTo(x + 22, baseY + 21);
      this.ctx.stroke();
    }
  }

  drawTreeSet(id, row, leaf, trunk) {
    this.frames.set(id, row);
    for (let f = 0; f < 8; f++) {
      const x = f * this.cell;
      const sway = Math.sin((f / 8) * Math.PI * 2) * 2;
      const baseY = row * this.cell;
      this.ctx.fillStyle = 'rgba(38,48,38,.22)';
      this.ctx.beginPath();
      this.ctx.ellipse(x + 17, baseY + 27, 10, 3, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = trunk;
      this.ctx.beginPath();
      this.ctx.moveTo(x + 14, baseY + 29);
      this.ctx.quadraticCurveTo(x + 17 + sway * 0.2, baseY + 21, x + 16, baseY + 13);
      this.ctx.lineTo(x + 20, baseY + 13);
      this.ctx.quadraticCurveTo(x + 19 + sway * 0.2, baseY + 22, x + 20, baseY + 29);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.fillStyle = leaf;
      for (const blob of [[16,10,10],[10,14,7],[22,14,8],[16,18,9],[13,7,6],[21,8,6]]) {
        this.ctx.beginPath();
        this.ctx.arc(x + blob[0] + sway, baseY + blob[1], blob[2], 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.fillStyle = id === 'mystic_tree' ? 'rgba(120,255,235,.75)' : 'rgba(150,215,105,.42)';
      this.ctx.beginPath();
      this.ctx.arc(x + 12 + sway, baseY + 7, 2, 0, Math.PI * 2);
      this.ctx.arc(x + 22 + sway, baseY + 14, 1.5, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }
}
