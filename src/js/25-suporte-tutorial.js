    /* ===================================================================
       SUPORTE
       =================================================================== */
    const FAQ = [
      ['Começando', 'Onde revejo o tutorial?', 'Em Configurações → Suporte → <b>Tutorial do Babinha</b>. São 6 capítulos curtos: o básico, as regras, imprevistos, ao vivo, baba points e conta. Dá pra ver em qualquer ordem.'],
      ['Começando', 'Como começo um baba?', 'Escolha a turma em <b>Início → Turmas</b> (ou crie uma), confirme e vá em <b>Lista</b> marcando quem chegou, na ordem. Depois, em <b>Times</b>, toque em Montar times.'],
      ['Começando', 'Preciso de internet na quadra?', 'Não. Tudo fica salvo no celular e vai pra nuvem quando o sinal voltar. O pontinho no seu avatar mostra: verde é sincronizado, amarelo é esperando internet.'],
      ['Começando', 'Como instalo o BABA no celular?', 'No Android, abra o site no Chrome e toque em <b>Adicionar à tela inicial</b>. No iPhone, no Safari, toque em Compartilhar → <b>Adicionar à Tela de Início</b>.'],
      ['Na quadra', 'Como a fila e os times funcionam?', 'Quem chega primeiro joga primeiro. Quem perde vai pro fim da fila e o próximo entra. No empate, você escolhe em Times se sai o rei, saem os dois ou se decide nos pênaltis.'],
      ['Na quadra', 'Como registro um gol?', 'No Placar, toque em <b>Gol</b> do lado certo, escolha quem fez e depois quem deu o passe (ou "Sem assistência").'],
      ['Na quadra', 'Errei um lance, e agora?', 'Use <b>Desfazer</b> nos lances da partida. Se já finalizou a partida, em Stats → Times e jogos tem "Desfazer última".'],
      ['Na quadra', 'Alguém se machucou. Dá pra trocar?', 'Sim. Em Times, toque no jogador em quadra e escolha quem entra. Quem sai pode ir pro começo ou fim da fila, ou sair do baba.'],
      ['Na quadra', 'Como deixo o placar em tela cheia?', 'No Placar, com os times em quadra, toque no botão de expandir ao lado do relógio. O celular vira um placar deitado pra galera ver.'],
      ['Compromisso', 'Como puxo a lista do próximo baba?', 'Dono ou adm: abra a turma e toque em <b>Puxar lista</b>. Escolha dia, hora, local e, se quiser, o número de vagas. A turma recebe o aviso no celular, um card no chat e um pop-up ao abrir o app.'],
      ['Compromisso', 'Dá pra usar a lista do WhatsApp?', 'Sim. Na lista, toque em <b>Colar lista</b> e cole o texto do grupo. O BABA lê os nomes (com número, emoji, "Não vão:", "Talvez:") e acha quem é da turma, mesmo com apelido ou sem acento. Os que não bateram você confere antes de salvar.'],
      ['Compromisso', 'O que acontece com quem miou?', 'No fim do dia o adm fecha a presença: cumpriu, miou ou justificou. Com a penalidade automática, as faltas viram aviso, depois baixa prioridade (entra na lista depois dos outros) e bloqueio (não confirma sozinho). Quando chega no limite de banir, o BABA só sugere: quem decide é o adm. Os números ficam em <b>Regras de presença</b>, dentro da turma.'],
      ['Compromisso', 'Como salvo o baba na agenda?', 'Na lista, toque em <b>Salvar na agenda</b> (abre no Calendário do iPhone, do Android ou no Outlook) ou em <b>Google Agenda</b>. O horário vai certinho pro fuso do seu celular, com lembrete 2 h antes.'],
      ['Turmas', 'O que é turma pública?', 'O adm liga em <b>Ranking, troféus e desafios</b> → Desafios → Turma pública. Ela passa a aparecer em <b>Explorar turmas</b>, mostra ranking e troféus a qualquer pessoa e pode desafiar outras turmas. Pra entrar nela, continua precisando do convite. Desligando, volta a ser privada.'],
      ['Turmas', 'Como funciona o ranking?', 'Dentro da turma, toque em <b>Ranking, troféus e desafios</b>. Escolha Última partida ou Temporada (6 meses), o número (gols, assistências, participações, vitórias, jogos ou defesas) e Top 10 ou Top 26. Só contam babas encerrados.'],
      ['Turmas', 'Como ganho troféu?', 'No fim de cada temporada de 6 meses (jan a jun e jul a dez), quem liderou cada categoria ganha o troféu na prateleira da turma, desde que a turma tenha pelo menos 3 babas na temporada. Campeonatos ganhos também viram troféu.'],
      ['Turmas', 'O que é prestígio?', 'É a pontuação da turma: babas encerrados, atletas ativos, desafios jogados e ganhos, campeonatos e troféus. O nível (Bronze, Prata, Ouro, Diamante) sobe com os pontos. Toque em “Como o prestígio é calculado” pra ver a conta.'],
      ['Turmas', 'Como desafio outra turma?', 'Com a turma pública, abra Desafios e toque em <b>Desafiar uma turma</b> (convite fechado) ou <b>Desafio aberto</b> (fica no mural de Explorar até uma turma aceitar). Depois do jogo, um adm lança o placar e o da outra turma confirma. Sem resposta em 72 h, o placar vale.'],
      ['Turmas', 'Como funciona o campeonato?', 'Em Explorar → Campeonatos, o adm de uma turma pública cria (3 a 8 turmas). As outras se inscrevem e o organizador começa: o app monta todos contra todos e vai montando a classificação (vitória 3, empate 1). Quem ficar em primeiro leva o troféu.'],
      ['Na quadra', 'Como escolho o tamanho do jogo?', 'No Placar, em <b>Jogo (na linha)</b>, de <b>1v1 a 12v12</b>. Conta só quem joga na linha; o goleiro é escolhido ao lado.'],
      ['Na quadra', 'Como funciona o goleiro?', 'No Placar (ou em Times → Regras), em <b>Goleiro</b>: <b>do time</b> (quem tem GOL marcado entra junto com o time; num 4v4 o time tem 5), <b>fixo</b> (os goleiros ficam no gol a noite toda e não entram na fila), <b>da fila</b> (os dois próximos da fila vão pro gol e não perdem o lugar, como na planilha) ou <b>sem goleiro</b>.'],
      ['Na quadra', 'Dá pra decidir o empate nos pênaltis?', 'Sim: Times → Regras → Empate → <b>Pênaltis decidem</b>. No empate abre a disputa: 5 cobranças pra cada lado, depois alternadas. Marque gol, defesa ou fora. Gols e defesas nas cobranças contam no Stats, em <b>Pênaltis</b>; o placar do jogo fica empatado.'],
      ['Na quadra', 'Como troco atletas entre os times?', 'Em Times, toque em <b>Trocar</b> ao lado de quem sai e, lá embaixo, em <b>Trocar com o outro time</b>. Ninguém vai pra fila.'],
      ['Na quadra', 'Quero montar os times do zero.', 'Em Times, toque em <b>Escolher os times na mão</b> (ou <b>Mexer nos times</b>, se já tem time em quadra) e mande cada um pro Time A, Time B ou pra fila.'],
      ['Na quadra', 'Alguém foi embora. Como tiro da fila?', 'Na aba <b>Times</b>, toque no <b>x</b> ao lado do nome na fila de espera. Se a pessoa estiver em quadra, toque no nome dela e em <b>Foi embora</b>. Os números do dia continuam.'],
      ['Na quadra', 'O que é a régua de tempo?', 'Em Times → Regras: quem chega depois do tempo escolhido (contado do primeiro jogo) entra em 1º na fila. Quem chega antes disso vai pro fim, como sempre.'],
      ['Na quadra', 'Dá pra quem jogou menos jogar antes?', 'Sim: Times → Regras → Ordem da fila → <b>Quem jogou menos</b>. A fila se arruma sozinha pelo número de jogos do dia.'],
      ['Na quadra', 'Como corrijo o gol de alguém?', 'Toque no nome da pessoa (na Lista, no time ou na fila) e ajuste gols, assistências e defesas em <b>Números de hoje</b>.'],
      ['Na quadra', 'Tem jogadora no baba. Como marco?', 'Abra a ficha dela e escolha <b>Jogadora</b>. Os destaques viram artilheira, garçonete e paredona, e a turma guarda isso pros próximos babas.'],
      ['Ao vivo', 'Como assisto um jogo pelo código?', 'Na tela de entrada do app (ou em <b>Início</b>, se já tem conta), toque em <b>Assistir um jogo ao vivo</b> e digite o código que aparece no celular de quem organiza. Não precisa de conta pra assistir.'],
      ['Ao vivo', 'O que é o Desafio 1v1?', 'No jogo ao vivo, maiores de 18 desafiam alguém direto: <b>quem vence</b> ou <b>quem faz mais gols</b> na partida. Os dois põem os mesmos pontos, quem acertar leva tudo e empate devolve. Se a pessoa não aceitar até a partida acabar, os pontos voltam.'],
      ['Ao vivo', 'De onde vêm os multiplicadores?', 'Dos números da turma: gols por partida de cada um (puxados pra média enquanto a pessoa tem poucos jogos), vitórias e o placar do momento. A porcentagem ao lado é a chance calculada. Quem quase nunca marca aparece com até x20.'],
      ['Baba points', 'O que é o card de atleta?', 'É a sua figurinha no BABA: foto, nome, codinome, título, mascote e seus números. Fica no <b>Perfil</b>, e a galera vê ao tocar em você na turma ou no chat. O fundo, o título e o mascote saem da lojinha.'],
      ['Baba points', 'Como funciona o anúncio de gol?', 'Compre um <b>Anúncio de gol</b> (e, se quiser, um <b>Som de gol</b>) na lojinha, aba Gol. Quando você marcar com o nome ligado à conta, o celular de quem organiza mostra seu cartão e toca seu som, e quem assiste ao vivo vê o cartão.'],
      ['Baba points', 'O que é a pipoca?', 'Uma zoeira de 150 pontos: abra o card de alguém da sua turma e toque em <b>Jogar pipoca</b>. Ela fica 24 h no card e na foto da pessoa. Uma por vez em cada card, até 3 por dia.'],
      ['Ao vivo', 'Como recebo os gols no celular?', 'No jogo ao vivo, toque em <b>Avisar gols</b>. Pra todos os babas das suas turmas, ligue em Configurações → <b>Avisos dos babas das minhas turmas</b>. No iPhone, os avisos só funcionam com o BABA instalado na tela de início.'],
      ['Baba points', 'Como ganho baba points?', 'No bônus do dia, nas <b>Missões da semana</b> (na Lojinha) e acertando palpites. As missões renovam toda segunda.'],
      ['Turmas e convites', 'Como chamo a galera pra turma?', 'Abra a turma e toque em <b>Convidar</b>. Mande o link no grupo: quem entrar vê a turma e o histórico, e toca no próprio nome pra ligar à conta.'],
      ['Turmas e convites', 'Qual a diferença entre dono e adm?', 'O <b>adm</b> adiciona e remove atletas, marca goleiro, convida e tira pessoas. O <b>dono</b> faz tudo isso e ainda escolhe os adms, passa a turma pra outra pessoa e é o único que pode excluir a turma.'],
      ['Turmas e convites', 'Como dou adm pra alguém?', 'O dono abre a turma → <b>Pessoas e cargos</b> → toca na pessoa → <b>Tornar adm</b>. A pessoa precisa ter entrado pelo convite.'],
      ['Turmas e convites', 'Como ligo meu nome à minha conta?', 'Abra sua turma e toque no seu nome na lista de atletas. Seus gols, assistências e vitórias de todos os babas aparecem em "Meus números".'],
      ['Turmas e convites', 'Como coloco foto na turma?', 'Dono ou adm: abra a turma e toque no quadradinho ao lado do nome. Dá pra usar uma foto ou um ícone.'],
      ['Conta e segurança', 'Esqueci minha senha.', 'Na tela de entrar, toque em <b>Esqueci minha senha</b> e use o código de recuperação que apareceu quando você criou a conta.'],
      ['Conta e segurança', 'Perdi o código de recuperação.', 'Se ainda estiver conectado em algum celular, vá em Configurações → <b>Novo código de recuperação</b>.'],
      ['Conta e segurança', 'Posso usar a digital?', 'Sim, em Configurações → Segurança → <b>Pedir digital ao abrir</b>. É uma trava daquele celular: o BABA pede a digital sempre que abrir.'],
      ['Conta e segurança', 'Usei o BABA num celular emprestado.', 'Em Configurações → Segurança → <b>Sair dos outros aparelhos</b>. Só o celular que você está usando continua conectado.'],
      ['Recordações', 'Como faço o PDF com fotos?', 'Em Configurações → <b>PDF do baba com fotos</b> (ou Stats → Times e jogos → PDF). Escolha as fotos, o título e um recado. A primeira foto vira a capa.'],
      ['Recordações', 'Onde ficam os babas antigos?', 'Em Configurações → <b>Babas anteriores</b>, ou dentro da turma em <b>Babas anteriores da turma</b>. Qualquer pessoa da turma (dono, adm ou membro) vê cada baba com os números de todo mundo, e cada um gera PDF.'],
      ['App', 'Como deixo no modo escuro?', 'Configurações → Aparência → <b>Escuro</b>. Em "Auto" o BABA segue o tema do celular.'],
      ['App', 'As letras estão pequenas.', 'Configurações → Aparência → <b>Texto maior</b>.'],
      ['App', 'Como aparece o clima no Início?', 'Toque em <b>Ver o clima</b> e permita a localização. Ela fica só no seu celular, arredondada; o clima vem do Open-Meteo e atualiza a cada 20 minutos.'],
      ['App', 'Como mando o Babinha no chat?', 'No chat, toque na carinha ao lado da mensagem: tem as figurinhas do Babinha e os emojis. Mensagem só com emoji aparece grandona.']
    ];

    function openSupport() {
      document.getElementById('faq-search').value = '';
      renderFaq('');
      renderTutorialHub();
      document.getElementById('page-support').classList.remove('hidden');
      document.getElementById('page-support').scrollTop = 0;
      pushPage('page-support');
    }
    function closeSupport() {
      document.getElementById('page-support').classList.add('hidden');
      popPage('page-support');
    }

    function renderFaq(filter) {
      const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const words = norm(filter || '').split(/\s+/).filter(Boolean);
      const hits = FAQ.filter(([cat, q, a]) => words.every(w => norm(cat + ' ' + q + ' ' + a.replace(/<[^>]+>/g, '')).includes(w)));
      const box = document.getElementById('faq-list');
      if (!hits.length) {
        box.innerHTML = `<div class="card-flat p-4 flex items-center gap-3"><img src="babinha/worried.webp" alt="" class="w-14 h-14 object-contain flex-shrink-0" /><p class="text-[14px] text-ink-2 leading-snug">Não achei nada sobre isso. Tente outra palavra, tipo <b class="text-ink">turma</b>, <b class="text-ink">gol</b> ou <b class="text-ink">senha</b>.</p></div>`;
        return;
      }
      const cats = [...new Set(hits.map(h => h[0]))];
      box.innerHTML = cats.map(cat => `
        <section>
          <p class="eyebrow mb-2 px-1">${cat}</p>
          <div class="card-flat overflow-hidden divide-y divide-ink/[0.07]">
            ${hits.filter(h => h[0] === cat).map(([, q, a]) => `
              <details class="faq-item"${words.length ? ' open' : ''}>
                <summary class="flex items-center gap-3 px-4 py-3.5 text-[15px] font-semibold">
                  <span class="flex-1">${q}</span><i class="faq-chev fa-solid fa-chevron-down text-[12px] text-ink-3 transition"></i>
                </summary>
                <p class="px-4 pb-4 -mt-1 text-[14px] text-ink-2 leading-relaxed">${a}</p>
              </details>`).join('')}
          </div>
        </section>`).join('');
    }

    /* ===================================================================
       TUTORIAL DO BABINHA (v9.5.1)
       Six short chapters. The first one ("O básico") runs on the first
       login; the others live in Suporte → Tutorial and on a home card.
       A step can spotlight a real part of the app (target) and/or play a
       small animated scene (demo) for rules that are hard to picture.
       =================================================================== */
    const TUTORIAL = [
      { id: 'basico', title: 'O básico do baba', img: 'aidentro', desc: 'Da turma ao apito final, do jeito que um baba roda.', steps: [
        { img: 'wave', tab: 'inicio', title: 'E aí! Eu sou o Babinha.', text: 'Já levei muita bicuda nesse baba, olha o band-aid. Em 10 passos te mostro como um baba roda no BABA, do começo ao fim.' },
        { img: 'aidentro', tab: 'inicio', target: '#home-mine', fallback: '#home-babinha', title: 'Tudo começa na turma', text: 'A turma é o grupo fixo do seu baba: os atletas, quem é goleiro e o histórico de todos os jogos. Crie a sua ou entre pelo link de convite que a galera mandou.' },
        { img: 'coach', tab: 'inicio', target: '#home-events', fallback: '#home-babinha', title: 'A lista do próximo baba', text: 'O adm puxa a lista na turma e todo mundo responde Vou, Talvez ou Não vou, até pelo chat. Dá pra colar a lista do WhatsApp e salvar o baba na agenda.' },
        { img: 'run', tab: 'ficha', target: '#sheet-players-tbody', fallback: '#tab-nav-ficha', title: 'Lista de chegada', text: 'No dia, marque quem chegou, na ordem em que chegou. Essa ordem vira a fila: quem chega primeiro, joga primeiro. Apareceu alguém de fora? Adicione como convidado.' },
        { img: 'coach', tab: 'fila', target: '#court-manager', title: 'Montar os times', text: 'Em Times, toque em Montar: o BABA pega os primeiros da fila e monta Time 1 x Time 2. O tamanho vem do jogo escolhido no Placar (ex.: 4v4 com goleiro do time = 5 por time). Prefere escolher? Dá pra montar na mão.' },
        { img: 'calculante', tab: 'fila', demo: 'rotacao', title: 'Rei da Quadra: quem perde sai', text: 'Quem ganha fica. Quem perde volta pro fim da fila, um por um, e os primeiros da fila entram. Assim os times vão se misturando a noite toda.' },
        { img: 'tired', tab: 'placar', target: '#placar-clock', title: 'Relógio e acréscimo', text: 'Escolha o tempo de jogo e dê play. Precisou? +1, +2 ou +3 de acréscimo. Pode apagar a tela: o relógio continua certo.' },
        { img: 'siuu', tab: 'placar', target: '#placar-sides', title: 'Gol, passe e defesa', text: 'Toque em Gol no time que marcou, escolha quem fez e quem deu o passe. Defesa do goleiro também conta. Tudo isso vira estatística.' },
        { img: 'red', tab: 'placar', target: '#btn-finish', title: 'Finalizar a partida', text: 'Acabou? Finalize: o placar vai pro histórico, o vencedor fica e o próximo time entra. Errou alguma coisa? Tem Desfazer.' },
        { img: 'champion', tab: 'inicio', title: 'Pronto pro primeiro baba!', text: 'Tem mais 5 capítulos curtinhos: regras, imprevistos, ao vivo, baba points e conta. Ficam em Configurações → Ajuda → Tutorial, e o Início te lembra.' }
      ] },
      { id: 'regras', title: 'Regras do Rei da Quadra', img: 'calculante', desc: 'Tamanho do jogo, goleiro, empate e pênaltis, fila e régua de tempo.', steps: [
        { img: 'calculante', tab: 'placar', target: '#match-game-format', title: 'Tamanho do jogo e goleiro', text: 'Escolha de 1v1 a 12v12, contando só a linha. Ao lado, o goleiro: do time (entra junto: 4v4 vira 5 por time), fixo, da fila ou sem goleiro.' },
        { img: 'coach', tab: 'fila', target: '#rules-card', title: 'Empate e vitórias seguidas', text: 'No empate, você escolhe: sai o rei, saem os dois ou pênaltis (5 cobranças pra cada lado, e os gols contam no Stats). E dá pra limitar: depois de 2 ou 3 vitórias seguidas, o time sai mesmo ganhando.' },
        { img: 'arrogante', tab: 'fila', demo: 'menosjogos', title: 'Ordem da fila', text: 'Ordem de chegada é o padrão. Em "Quem jogou menos", a fila se arruma sozinha: quem tem menos jogos no dia vai pra frente.' },
        { img: 'bike', tab: 'fila', demo: 'regua', title: 'Régua de tempo (atrasados)', text: 'Sem régua, atrasado vai pro fim. Com a régua em 1 h, por exemplo: quem chega depois de 1 h do primeiro jogo entra em 1º na fila; antes disso, vai pro fim.' },
        { img: 'wink', tab: 'fila', demo: 'goleiro', title: 'Goleiro da fila', text: 'Goleiro fixo: quem é goleiro não sai do gol nem entra na fila. Goleiro da fila: os 2 próximos da fila vão pro gol, um em cada time, e não perdem o lugar.' },
        { img: 'tired', tab: 'placar', target: '#match-goal-limit-rule', title: 'Fim de jogo por gols', text: 'Além do tempo, a partida pode acabar com 2, 3 ou 5 gols, ou com diferença de 2. Bateu a meta, o BABA finaliza sozinho.' }
      ] },
      { id: 'meio', title: 'Imprevistos no meio do baba', img: 'carretilha', desc: 'Ficha, substituição, trocas entre times, atrasados e desfazer.', steps: [
        { img: 'carretilha', tab: 'fila', target: '#court-manager', title: 'A ficha de cada um', text: 'Toque no nome de quem está no time ou na fila: muda nome, posição, jogador ou jogadora, e corrige gols, passes e defesas do dia, sem tirar ninguém do time.' },
        { img: 'run', tab: 'fila', target: '#court-manager', title: 'Substituição', text: 'Cansou ou machucou? Toque em Trocar ao lado do nome e escolha quem entra. Quem sai pode voltar pro começo ou pro fim da fila.' },
        { img: 'coach', tab: 'fila', target: '#court-manager', title: 'Mexer nos times', text: 'Time desequilibrado? No Trocar dá pra trocar dois atletas entre os times. E em Mexer nos times você manda cada um pro Time A, Time B ou pra fila.' },
        { img: 'worried', tab: 'fila', target: '#queue-card', title: 'Alguém foi embora', text: 'Na fila, toque no x ao lado do nome. Se a pessoa estava em quadra, abra a ficha e toque em Foi embora. Os números do dia continuam valendo.' },
        { img: 'bike', tab: 'ficha', target: '#tab-nav-ficha', title: 'Chegou atrasado', text: 'Marque a chegada na Lista a qualquer hora. A pessoa entra no fim da fila, ou em 1º se a régua de tempo estiver ligada e já tiver passado o tempo.' },
        { img: 'ney', tab: 'placar', target: '#btn-court-mode', title: 'Placar deitado', text: 'Com os dois times em quadra, este botão deita o celular com um placar gigante, pra galera ver de longe.' },
        { img: 'scared', tab: 'placar', target: '#btn-undo', title: 'Desfazer', text: 'Gol marcado errado? Desfaça o último lance. Finalizou sem querer? O aviso de partida finalizada tem Desfazer, e em Stats → Jogos também.' }
      ] },
      { id: 'aovivo', title: 'Ao vivo, palpites e chat', img: 'chute', desc: 'Transmitir pelo QR, assistir pelo código, palpites, desafios e chat.', steps: [
        { img: 'chute', tab: 'placar', target: '#live-pill', title: 'Transmitir o jogo', text: 'Com internet, toque em Transmitir: aparece um QR code e um código. Quem escanear ou digitar o código acompanha o placar ao vivo, mesmo sem conta.' },
        { img: 'aidentro', tab: 'inicio', target: '#home-v7', title: 'Assistir pelo código', text: 'Recebeu um código? No Início (ou na tela de entrada do app), toque em "Assistir um jogo ao vivo" e digite.' },
        { img: 'calculante', tab: 'inicio', title: 'Palpites (só 18+)', text: 'No ao vivo, quem tem conta e 18 anos ou mais palpita com baba points: quem faz gol, quem vence. O multiplicador e a chance (%) saem dos números da turma. Pontos não valem dinheiro: é brincadeira.' },
        { img: 'arrogante', tab: 'inicio', title: 'Desafio 1v1', text: 'Quer provocar o amigo? Desafie direto: quem vence ou quem faz mais gols. Os dois põem os mesmos pontos e quem acertar leva tudo. Empate devolve.' },
        { img: 'shhh', tab: 'inicio', title: 'Chat da turma e do jogo', text: 'Cada turma tem chat, e cada jogo ao vivo também, com figurinhas do Babinha na carinha ao lado da mensagem. Mensagem ofensiva? Toque no ⋯ e denuncie: com 3 denúncias ela some e o suporte fica sabendo.' }
      ] },
      { id: 'pontos', title: 'Baba points e lojinha', img: 'dancinha', desc: 'Bônus do dia, missões da semana, lojinha e exclusivos.', steps: [
        { img: 'money', tab: 'inicio', target: '#tab-nav-loja', title: 'Seus baba points', text: 'Toda conta começa com 1.000 pontos. Ganha mais no bônus do dia, nas missões da semana e acertando palpites. Não se compram e não valem dinheiro.' },
        { img: 'calculante', tab: 'inicio', title: 'Missões da semana', text: 'Na Lojinha: abrir o app 3 dias, jogar um baba, marcar gols, organizar... Cada missão vale pontos. Cumpriu? Toque em Pegar. Renova toda segunda.' },
        { img: 'dancinha', tab: 'inicio', title: 'Lojinha', text: 'Troque pontos por molduras, nomes coloridos, brilhos, títulos, codinome, mascote, fundo do card e até o anúncio e o som do seu gol. Tudo aparece no seu card de atleta.' },
        { img: 'siuu', tab: 'inicio', target: '#header-profile', title: 'Card de atleta e pipoca', text: 'Seu card fica no Perfil, e a galera abre tocando em você na turma ou no chat. No card de um amigo dá pra jogar pipoca: 150 pontos e ela fica lá 24 h.' },
        { img: 'aura', tab: 'inicio', title: 'Itens exclusivos', text: 'Alguns itens não estão à venda: a Aura de Fogo Azul é dos 100 primeiros do BABA. Ficam com o selo Fundador na lojinha.' }
      ] },
      { id: 'conta', title: 'Turma, conta e recordações', img: 'messi', desc: 'Convites e cargos, ligar seu nome, Stats, PDF, perfil e suporte.', steps: [
        { img: 'coach', tab: 'inicio', target: '#home-mine', fallback: '#home-babinha', title: 'Convite e cargos', text: 'Na turma, Convidar gera um link pro grupo. O dono escolhe os adms; adm adiciona e tira atletas, marca goleiro e convida. Só o dono exclui a turma.' },
        { img: 'wink', tab: 'inicio', target: '#home-mine', fallback: '#home-babinha', title: 'Ligue seu nome à conta', text: 'Abra a turma e toque no seu nome na lista: seus gols e jogos de todos os babas passam a ser seus, e contam nas missões da semana.' },
        { img: 'messi', tab: 'stats', target: '#tab-nav-stats', title: 'Stats e PDF', text: 'Artilharia, assistências e defesas do dia e de todos os babas. Em Jogos ficam os placares, e dá pra gerar o PDF do baba com as fotos da pelada.' },
        { img: 'shhh', tab: 'inicio', target: '#header-profile', title: 'Perfil e segurança', text: 'No perfil: foto, modo escuro, texto maior, digital e o código de recuperação. Guarde o código em segredo: é ele que salva sua conta se você esquecer a senha.' },
        { img: 'rezando', tab: 'inicio', target: '#header-profile', title: 'Deu ruim? Suporte', text: 'Configurações → Ajuda tem as dúvidas mais comuns, as notas de atualização e estes capítulos. E sempre tem o contatobabaapp@gmail.com.' }
      ] }
    ];

    /* Little animated scenes for the rules. Chips move between positions (left %, top px) frame by frame. */
    const DEMOS = {
      rotacao: { h: 114,
        deco: '<span class="dlabel" style="left:2%;top:0">Em quadra</span><span class="dlabel" style="left:62%;top:0">Fila</span><span class="dline" style="left:58%;top:4px;height:108px"></span>' +
              '<span class="dlabel" style="left:2%;top:50px;letter-spacing:.04em">x</span>',
        chips: [['a1', 'Ana', 'a'], ['a2', 'Beto', 'a'], ['a3', 'Caio', 'a'], ['b1', 'Duda', 'b'], ['b2', 'Edu', 'b'], ['b3', 'Fê', 'b'], ['q1', 'Gui', 'q'], ['q2', 'Hugo', 'q'], ['q3', 'Ivo', 'q'], ['q4', 'Jô', 'q']],
        frames: [
          { cap: 'Time 1 (amarelo) x Time 2 (verde). Deu Time 2.', pos: { a1: [2, 22], a2: [20, 22], a3: [38, 22], b1: [2, 72], b2: [20, 72], b3: [38, 72], q1: [62, 18], q2: [62, 41], q3: [62, 64], q4: [62, 87] } },
          { cap: 'Time 2 fica. Gui, Hugo e Ivo entram. Ana, Beto e Caio vão pro fim da fila, um por um.', cls: { q1: 'n', q2: 'n', q3: 'n' },
            pos: { b1: [2, 22], b2: [20, 22], b3: [38, 22], q1: [2, 72], q2: [20, 72], q3: [38, 72], q4: [62, 18], a1: [62, 41], a2: [62, 64], a3: [62, 87] } }
        ] },
      menosjogos: { h: 138,
        deco: '',
        chips: [['p1', 'Ana · 3 jogos', 'q'], ['p2', 'Bia · 1 jogo', 'q'], ['p3', 'Caio · 2 jogos', 'q'], ['p4', 'Duda · 0 jogo', 'n'], ['p5', 'Edu · 1 jogo', 'q']],
        frames: [
          { cap: 'Ordem de chegada: Ana chegou primeiro, então está na frente.', pos: { p1: [6, 4], p2: [6, 30], p3: [6, 56], p4: [6, 82], p5: [6, 108] } },
          { cap: 'Quem jogou menos: Duda (0 jogo) vai pra frente, Ana (3 jogos) pro fim.', pos: { p4: [6, 4], p2: [6, 30], p5: [6, 56], p3: [6, 82], p1: [6, 108] } }
        ] },
      regua: { h: 114,
        deco: '<span class="druler" style="left:2%;right:2%;top:26px"></span><span class="dtick" style="left:2%;top:20px"></span><span class="dtick" style="left:66%;top:20px"></span>' +
              '<span class="dlabel" style="left:0;top:0">20:00 · 1º jogo</span><span class="dlabel dlabel-hi" style="left:54%;top:0">21:00 · régua de 1 h</span>' +
              '<span class="dlabel" style="left:2%;top:68px">Fila</span>',
        chips: [['q1', 'Gui', 'q'], ['q2', 'Hugo', 'q'], ['q3', 'Ivo', 'q'], ['ana', 'Ana 20:20', 'a'], ['bia', 'Bia 21:10', 'b']],
        frames: [
          { cap: 'Ana chegou às 20:20, antes de 1 h do primeiro jogo...', hide: ['bia'], pos: { q1: [2, 88], q2: [21, 88], q3: [40, 88], ana: [22, 40], bia: [74, 40] } },
          { cap: '...então vai pro fim da fila, como sempre.', hide: ['bia'], pos: { q1: [2, 88], q2: [21, 88], q3: [40, 88], ana: [59, 88], bia: [74, 40] } },
          { cap: 'Bia chegou às 21:10, depois da régua de 1 h...', pos: { q1: [2, 88], q2: [21, 88], q3: [40, 88], ana: [59, 88], bia: [74, 40] } },
          { cap: '...e entra em 1º na fila.', pos: { bia: [2, 88], q1: [24, 88], q2: [43, 88], q3: [62, 88], ana: [81, 88] } }
        ] },
      goleiro: { h: 118,
        deco: '<span class="dgoal" style="left:1%;top:14px">GOL</span><span class="dgoal" style="right:1%;top:14px">GOL</span><span class="dlabel" style="left:2%;top:72px">Fila</span>' +
              '<span class="dlabel" style="left:28%;top:0">Time 1</span><span class="dlabel" style="left:58%;top:0">Time 2</span>',
        chips: [['a1', 'Ana', 'a'], ['a2', 'Beto', 'a'], ['b1', 'Duda', 'b'], ['b2', 'Edu', 'b'], ['g1', 'Gui', 'q'], ['g2', 'Hugo', 'q'], ['q3', 'Ivo', 'q'], ['q4', 'Jô', 'q'], ['s1', 'vaga do Gui', 'ghost'], ['s2', 'vaga do Hugo', 'ghost']],
        frames: [
          { cap: '4v4 com goleiro da fila: os 2 primeiros da fila são Gui e Hugo...', hide: ['s1', 's2'], pos: { a1: [27, 24], a2: [27, 52], b1: [57, 24], b2: [57, 52], g1: [2, 92], g2: [30, 92], q3: [60, 92], q4: [77, 92], s1: [2, 92], s2: [30, 92] } },
          { cap: '...então eles vão pro gol, um de cada lado, e o lugar deles na fila fica guardado.', cls: { g1: 'gk', g2: 'gk' }, pos: { a1: [27, 24], a2: [27, 52], b1: [57, 24], b2: [57, 52], g1: [1, 31], g2: [79, 31], q3: [60, 92], q4: [77, 92], s1: [2, 92], s2: [30, 92] } }
        ] }
    };

    let tourChapter = null;   // the chapter being shown
    let tourIndex = -1;
    let tourOnEnd = null;
    let demoTimer = null;
    const TOUR_STEPS = () => (tourChapter ? tourChapter.steps : []);

    function startTour(force, onEnd, chapterId) {
      if (!force && prefs.tutorialDone) { if (onEnd) onEnd(); return; }
      // A first-time user gets the tour; the release notes are for people coming back.
      if (!force) lsSet(NOTES_KEY, APP_VERSION);
      tourChapter = TUTORIAL.find(c => c.id === (chapterId || 'basico')) || TUTORIAL[0];
      tourOnEnd = onEnd || null;
      ['modal-database', 'modal-turma-edit', 'modal-account', 'modal-backup', 'modal-export', 'modal-popup'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      if (!document.getElementById('page-support').classList.contains('hidden')) closeSupport();
      if (!document.getElementById('page-profile').classList.contains('hidden')) closeProfile();
      if (!document.getElementById('page-settings').classList.contains('hidden')) closeSettings();
      closeShop();
      tourIndex = 0;
      document.getElementById('toast-container').innerHTML = '';
      document.getElementById('tour').classList.remove('hidden');
      document.getElementById('tour-dots').innerHTML = TOUR_STEPS().map(() => '<span class="tour-dot"></span>').join('');
      showTourStep();
      window.addEventListener('resize', placeTour);
    }
    function startChapter(id) { startTour(true, null, id); }

    function tourGo(delta) {
      const next = tourIndex + delta;
      if (next < 0) return;
      if (next >= TOUR_STEPS().length) { endTour(false); return; }
      tourIndex = next;
      showTourStep();
    }

    function showTourStep() {
      const steps = TOUR_STEPS();
      const step = steps[tourIndex];
      if (step.tab) switchTab(step.tab);
      document.getElementById('tour-img').src = `babinha/${step.img}.webp`;
      const n = TUTORIAL.indexOf(tourChapter) + 1;
      document.getElementById('tour-step').innerText = `Capítulo ${n} · ${tourChapter.title} · ${tourIndex + 1} de ${steps.length}`;
      document.getElementById('tour-title').innerText = step.title;
      document.getElementById('tour-text').innerText = step.text;
      document.querySelectorAll('#tour-dots .tour-dot').forEach((d, i) => d.classList.toggle('on', i === tourIndex));
      document.getElementById('tour-back').classList.toggle('invisible', tourIndex === 0);
      document.getElementById('tour-next').innerText = tourIndex === steps.length - 1 ? 'Bora!' : 'Próximo';
      renderDemo(step.demo);
      const el = tourTarget(step);
      if (el && el.closest('main')) el.scrollIntoView({ block: 'center', behavior: prefs.reduceMotion ? 'auto' : 'smooth' });
      setTimeout(placeTour, prefs.reduceMotion ? 30 : 380);
      placeTour();
    }

    /* Plays a demo scene: every few seconds the chips move to the next frame (and loop). */
    function renderDemo(name) {
      clearInterval(demoTimer);
      demoTimer = null;
      const box = document.getElementById('tour-demo');
      const d = name && DEMOS[name];
      if (!d) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      box.classList.remove('hidden');
      box.innerHTML = `<div class="dstage" style="height:${d.h}px">${d.deco}${d.chips.map(([id, t, k]) => `<span class="dchip dchip-${k}" data-id="${id}" data-k="${k}">${escapeHtml(t)}</span>`).join('')}</div>
        <p class="dcap"></p><div class="dprog">${d.frames.map(() => '<i></i>').join('')}</div>`;
      let f = 0;
      const show = () => {
        const fr = d.frames[f];
        box.querySelectorAll('.dchip').forEach(c => {
          const p = fr.pos[c.dataset.id];
          if (p) { c.style.left = p[0] + '%'; c.style.top = p[1] + 'px'; }
          c.style.opacity = (fr.hide || []).includes(c.dataset.id) ? '0' : '1';
          c.className = `dchip dchip-${(fr.cls && fr.cls[c.dataset.id]) || c.dataset.k}`;
        });
        box.querySelector('.dcap').innerText = fr.cap;
        box.querySelectorAll('.dprog i').forEach((b, i) => b.classList.toggle('on', i === f));
      };
      show();
      demoTimer = setInterval(() => { f = (f + 1) % d.frames.length; show(); }, prefs.reduceMotion ? 4200 : 3200);
    }

    function tourTarget(step) {
      const ok = sel => {
        const el = sel && document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4 ? el : null;
      };
      return ok(step.target) || ok(step.fallback);
    }

    function placeTour() {
      if (tourIndex < 0) return;
      const step = TOUR_STEPS()[tourIndex];
      const hole = document.getElementById('tour-hole');
      const card = document.getElementById('tour-card');
      const el = tourTarget(step);
      const vh = window.innerHeight;
      if (!el) {
        Object.assign(hole.style, { left: '50%', top: '40%', width: '0px', height: '0px' });
        hole.classList.remove('is-ring');
        card.classList.add('at-bottom');
        card.classList.remove('at-top');
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 6;
      Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      hole.classList.add('is-ring');
      const lower = r.top + r.height / 2 > vh * 0.5;
      card.classList.toggle('at-top', lower);
      card.classList.toggle('at-bottom', !lower);
    }

    function endTour(skipped) {
      document.getElementById('tour').classList.add('hidden');
      window.removeEventListener('resize', placeTour);
      clearInterval(demoTimer);
      demoTimer = null;
      const chapter = tourChapter;
      // Watched to the end (or skipped at the last step) counts as done.
      if (chapter && (!skipped || tourIndex === chapter.steps.length - 1)) markChapterDone(chapter.id);
      tourIndex = -1;
      tourChapter = null;
      switchTab('inicio');
      if (!prefs.tutorialDone) setPref('tutorialDone', true);
      if (skipped) showToast('Tutorial pausado. Os capítulos ficam em Configurações → Ajuda → Tutorial.');
      renderTutorialHub();
      renderHomeV7();
      const fn = tourOnEnd;
      tourOnEnd = null;
      if (fn) fn();
    }

    const chaptersDone = () => new Set(Array.isArray(prefs.tutorialChapters) ? prefs.tutorialChapters : []);
    function markChapterDone(id) {
      const done = chaptersDone();
      if (done.has(id)) return;
      done.add(id);
      setPref('tutorialChapters', TUTORIAL.map(c => c.id).filter(x => done.has(x)));
    }

    /* Suporte → Tutorial: one row per chapter, with a check when watched. */
    function renderTutorialHub() {
      const box = document.getElementById('tutorial-hub');
      if (!box) return;
      const done = chaptersDone();
      box.innerHTML = TUTORIAL.map((c, i) => `
        <button onclick="startChapter('${c.id}')" class="menu-row">
          <img src="babinha/${c.img}.webp" alt="" class="w-12 h-12 object-contain flex-shrink-0" />
          <span class="flex-1 min-w-0">
            <span class="block text-[12px] font-bold text-ink-2">Capítulo ${i + 1} · ${c.steps.length} passos</span>
            <span class="block">${escapeHtml(c.title)}</span>
            <span class="block text-[12px] font-medium text-ink-2 leading-snug">${escapeHtml(c.desc)}</span>
          </span>
          ${done.has(c.id) ? '<span class="w-7 h-7 rounded-full bg-leaf/15 text-leaf flex items-center justify-center flex-shrink-0" aria-label="Visto"><i class="fa-solid fa-check text-[12px]"></i></span>' : '<i class="fa-solid fa-play text-[12px] text-pitch flex-shrink-0"></i>'}
        </button>`).join('');
      const n = TUTORIAL.filter(c => done.has(c.id)).length;
      const sub = document.getElementById('tutorial-progress');
      if (sub) sub.innerText = `${n} de ${TUTORIAL.length} capítulos vistos`;
    }
    function openTutorialHub() {
      openSupport();
      setTimeout(() => { const el = document.getElementById('tutorial-section'); if (el) el.scrollIntoView({ block: 'start' }); }, 60);
    }
    function hideTutorialCard() { setPref('tutorialCardHidden', true); renderHomeV7(); }
    /* Home reminder while there are chapters left (until closed). */
    function tutorialCardHtml() {
      if (!prefs.tutorialDone || prefs.tutorialCardHidden) return '';
      const done = chaptersDone();
      const left = TUTORIAL.filter(c => !done.has(c.id));
      if (!left.length) return '';
      const next = left[0];
      return `
        <div class="card w-full p-3.5 flex items-center gap-3">
          <img src="babinha/${next.img}.webp" alt="" class="w-12 h-12 object-contain flex-shrink-0" />
          <button onclick="startChapter('${next.id}')" class="min-w-0 flex-1 text-left">
            <span class="block text-[12px] font-bold text-ink-2">Tutorial do Babinha · ${TUTORIAL.length - left.length} de ${TUTORIAL.length}</span>
            <span class="block text-[15px] font-bold leading-tight">Próximo: ${escapeHtml(next.title)}</span>
            <span class="block text-[12.5px] text-ink-2">${next.steps.length} passos · menos de 1 minuto</span>
          </button>
          <button onclick="hideTutorialCard()" class="btn-icon" aria-label="Esconder o lembrete do tutorial"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }

