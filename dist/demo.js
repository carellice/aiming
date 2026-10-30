import { uid, createBoard } from './data.js';

// A self-contained illustration: image cards remain available offline and in backups.
function mountainImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, '#b9c9c9');
  sky.addColorStop(0.45, '#eadbc1');
  sky.addColorStop(1, '#f4c89b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 960, 600);

  const glow = ctx.createRadialGradient(650, 190, 15, 650, 190, 220);
  glow.addColorStop(0, 'rgba(255,248,210,.75)');
  glow.addColorStop(1, 'rgba(255,248,210,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 960, 600);
  ctx.fillStyle = '#fff0cd';
  ctx.beginPath();
  ctx.arc(650, 190, 38, 0, Math.PI * 2);
  ctx.fill();

  const mountain = (points, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 600);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(960, 600);
    ctx.closePath();
    ctx.fill();
  };
  mountain([[0, 315], [65, 270], [125, 305], [235, 190], [300, 262], [390, 222], [480, 320], [590, 268], [680, 305], [780, 245], [880, 300], [960, 278]], '#a1aaa3');
  mountain([[0, 395], [105, 365], [220, 295], [325, 363], [425, 301], [520, 382], [660, 322], [790, 389], [895, 340], [960, 385]], '#728a80');
  mountain([[0, 430], [95, 458], [240, 386], [370, 449], [490, 391], [635, 462], [760, 415], [870, 455], [960, 424]], '#466d62');
  mountain([[0, 510], [130, 476], [265, 520], [390, 475], [510, 535], [670, 480], [800, 516], [960, 474]], '#254d47');

  // Fine grain gives the illustration a softer, paper-like finish.
  let seed = 1427;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  for (let index = 0; index < 15000; index++) {
    ctx.fillRect(random() * 960, random() * 600, 1, 1);
  }
  return canvas.toDataURL('image/jpeg', 0.88);
}

function card(type, x, y, width, height, title, content, color, category, extra = {}) {
  return { id: uid(), type, x, y, width, height, title, content, color, category, ...extra };
}

function task(text, done = false) {
  return { id: uid(), text, done };
}

export function createDemoWorkspace() {
  const project = createBoard('Il prossimo grande progetto', 'sparkles', '#e97b47');
  project.description = 'Un piccolo spazio per pensare in grande.';
  project.favorite = true;
  project.cards = [
    card('note', 110, 165, 260, 230,
      'E se partissimo da qui?',
      'Uno spazio semplice dove raccogliere pensieri sparsi e trasformarli in qualcosa di concreto.',
      '#fff1ae', 'L’IDEA'),
    card('note', 430, 165, 270, 230,
      'Meno rumore.\nPiù direzione.',
      'Dare alle idee lo spazio che meritano.',
      '#d9ecdf', 'DA ESPLORARE'),
    card('tasks', 750, 165, 280, 290,
      'I primi piccoli passi', '', '#ffffff', 'PIANO D’AZIONE', {
        tasks: [
          task('Mettere a fuoco l’idea', true),
          task('Raccogliere le ispirazioni'),
          task('Scegliere da dove iniziare'),
          task('Fare il primo passo'),
        ],
      }),
    card('image', 110, 445, 260, 300,
      'Cambia prospettiva',
      'Le cose belle iniziano da uno sguardo nuovo.', '#ffffff', 'ISPIRAZIONE', {
        src: mountainImage(),
        imageName: 'Ispirazione.jpg',
      }),
    card('text', 430, 435, 270, 180,
      'Un promemoria gentile',
      'Non serve avere tutto chiaro.\nServe solo iniziare.',
      '#eae5fa', 'DA RICORDARE'),
    card('note', 750, 505, 280, 240,
      'Le idee migliori arrivano quando lasci spazio.',
      'Prenditi una pausa. Torna con occhi nuovi.',
      '#f9dfcf', 'NOTE A MARGINE'),
    card('link', 430, 652, 270, 110,
      'Il posto giusto per le idee',
      'Un po’ di ispirazione per il tuo prossimo progetto.',
      '#ffffff', 'LINK UTILI', { url: 'https://miro.com/' }),
  ];
  project.connections = [
    { id: uid(), from: project.cards[0].id, to: project.cards[1].id, color: '#c7bca5' },
    { id: uid(), from: project.cards[1].id, to: project.cards[2].id, color: '#a6bbaa' },
  ];

  const ideas = createBoard('Idee in libertà', 'bulb', '#d6ae49');
  ideas.description = 'Nessun filtro. Solo possibilità.';
  ideas.cards = [
    card('note', 110, 165, 280, 220,
      'E se provassi qualcosa di nuovo?',
      'Un progetto personale, una nuova abitudine, una domanda diversa. Qui ogni idea trova posto.',
      '#fff1ae', 'SPUNTI'),
    card('text', 450, 205, 290, 190,
      'Lascia una porta aperta',
      'Le connessioni più interessanti nascono tra pensieri che sembravano lontani.',
      '#d9ecdf', 'POSSIBILITÀ'),
  ];

  const goals = createBoard('Obiettivi personali', 'target', '#8b92c5');
  goals.description = 'Una cosa alla volta, nella tua direzione.';
  goals.cards = [
    card('note', 110, 165, 280, 230,
      'Più spazio a ciò che conta',
      'Tempo per creare. Energia per imparare. Attenzione per le persone e le cose che mi fanno stare bene.',
      '#eae5fa', 'LA MIA DIREZIONE'),
    card('tasks', 450, 165, 290, 270,
      'Questa settimana', '', '#ffffff', 'PICCOLI PASSI', {
        tasks: [
          task('Ritagliare un’ora per un progetto personale'),
          task('Scrivere tre cose che voglio imparare'),
          task('Fare una passeggiata senza telefono'),
        ],
      }),
  ];

  return {
    version: 1,
    activeBoardId: project.id,
    boards: [project, ideas, goals],
    settings: { grid: 'dots', background: '#f8f9f7' },
  };
}
