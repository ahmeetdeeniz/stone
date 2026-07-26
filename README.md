# Stone — Codex Geliştirme Paketi

Stone; kişisel kullanım için tasarlanan, Markdown notlarını ve yazılım projelerini aynı yerde yöneten, cihazlar arasında eşitlenen sade bir çalışma alanıdır.

Bu paketin amacı Stone'u mümkün olduğunca az Codex promptuyla, kararları tekrar tekrar anlatmadan geliştirmektir.

## İlk sürümün özeti

- Android ve iOS
- React Native + Expo Development Build
- TypeScript + Expo Router
- Obsidian benzeri Live Preview Markdown editörü
- Saf ve taşınabilir Markdown
- Firebase Auth + Firestore
- Cihazda SQLite tabanlı local-first veri
- Notlar, projeler, sürümler, release checklist'leri
- Kanban ve Bugün ekranı
- Markdown içe/dışa aktarma
- Açık/koyu tema
- Bongita + Inter
- Morumsu lacivert tasarım dili

## Sonraki aşamalar

- ChatGPT Work / MCP bağlantısı
- Windows uygulaması
- Yerel proje klasörleri
- GitHub repo listeleme, clone, pull, commit ve push
- Yeni bilgisayarda bütün projeleri geri yükleme

## Paketi kullanma

1. Boş bir GitHub reposu oluştur.
2. Bu paketin içeriğini repo köküne kopyala.
3. `apps/mobile/assets/fonts/Bongita-Regular.ttf` yoluna kendi Bongita font dosyanı koy.
4. Firebase projesini oluşturup `docs/17-FIREBASE-SETUP.md` dosyasındaki adımları uygula.
5. Codex'i repo kökünde aç.
6. Önce `goals/01-FOUNDATION.goal.md` içeriğini `/goal` olarak gönder.
7. Goal tamamlanıp doğrulandıktan sonra sırayla 02, 03 ve 04'e geç.
8. Mobil v1 tamamen bitmeden `goals/future` altındaki goal'ları çalıştırma.

## Kaynakların öncelik sırası

Çelişki oluşursa aşağıdaki sıra geçerlidir:

1. `AGENTS.md`
2. `docs/16-LOCKED-DECISIONS.md`
3. `docs/12-ACCEPTANCE-CRITERIA.md`
4. İlgili teknik özellik dosyası
5. `PLAN.md`
6. `PROGRESS.md`

Codex bir çelişki bulursa tahmin yürütmemeli; çelişkiyi açıkça raporlamalıdır.

## Beklenen depo yapısı

```text
stone/
├── apps/
│   └── mobile/
├── packages/
│   ├── domain/
│   ├── markdown/
│   ├── editor/
│   └── sync/
├── services/
│   └── mcp/                 # v1 sonrasında
├── docs/
├── goals/
├── templates/
├── AGENTS.md
├── PLAN.md
└── PROGRESS.md
```

## Önemli not

Stone v1 bir Notion veya Obsidian klonu değildir. Ürün odağı:

> Markdown'ı çok iyi düzenlemek, projeleri sade biçimde takip etmek ve aynı verilere bütün kişisel cihazlardan güvenle ulaşmak.
