# Stone

**Kendi cihazlarınız arasında notlar, görevler, projeler, çizimler ve kurtarma için sakin, kişisel
bir Markdown çalışma alanı.**

[English README](README.md)

> **Genel önizleme.** Otomatik kaynak ve temiz klon kontrolleri geçmektedir. Fiziksel
> Android/iPhone/tablet, son erişilebilirlik ve canlı credential-restart kontrolleri hâlâ
> beklemektedir; binary dağıtım ayrıca aday sürüme özel doğrulama gerektirir.

Stone, asıl metni taşınabilir Markdown olarak korurken local-first proje takibi, Today özetleri,
sürüm/çakışma kurtarma ve düzenlenebilir `.stoneink` çizimleri sunar. Tek kişi için tasarlanmıştır;
ekip, ortak veritabanı veya eşzamanlı düzenleme ürünü değildir.

Stone ortak bir genel backend sağlamaz. Her kurulum sahibinin Firebase projesine; isteğe bağlı
olarak da kendi GitHub OAuth App’ine ve ayrıca dağıttığı MCP servisine bağlanır.

## Dil

İngilizce, Stone’un kanonik ve varsayılan arayüz dilidir. Türkçe mobil ve Windows uygulamalarında
tam olarak paketlenir. Ayarlar’dan **Sistem**, **English** veya **Türkçe** seçilebilir. Sürümlenmiş
tercih girişten önce yerel olarak saklanır; notlara, dışa aktarımlara, Firebase belgelerine veya MCP
şemalarına eşitlenmez.

Sistem modu `tr`, `tr-TR` ve `tr-CY` değerlerini Türkçe kabul eder. Desteklenmeyen dil veya
kullanılamayan locale verisi başlangıcı engellemeden İngilizceye döner. Arayüz dilini değiştirmek;
kullanıcının Markdown içeriğini, başlıklarını, frontmatter alanlarını, etiketlerini, dosya
yollarını, repository adlarını veya içe aktarılan veriyi çevirmez ya da yeniden yazmaz.

## Öne çıkanlar

- Markdown, özel rich-text biçimine dönüşmeden geçerli ve dışa aktarılabilir kalır.
- Mobil yazmalar önce SQLite’a dayanıklı biçimde kaydedilir; outbox, revision, soft-delete ve açık
  çakışma çözümü çevrimdışı değişiklikleri korur.
- Markdown-backed projeler; sürüm, blocker, görev, Kanban ve Today görünümlerini besler.
- Bağımsız ve Markdown bağlantılı görevler; tarih, öncelik, alt görev, tekrar ve proje ilişkileriyle
  birlikte çalışır.
- Takvim etkinlikleri ve görev zaman blokları local-first kalır; due date’ler zaman bloklarından
  ayrıdır ve tekrar kapsamları açıktır.
- Kronometre, geri sayım ve Pomodoro odak oturumları mobil ve Windows’ta local-first çalışır;
  duraklatma, manuel kayıt, çevrimdışı hedefler ve çakışmayı çift saymayan analizler desteklenir.
- `.stoneink` vektör kaynağı ve PNG önizleme ile çizimler düzenlenebilir kalır.
- Firebase, GitHub, imzalama hesapları ve MCP dağıtımı self-hoster’a aittir.

## Platformlar ve sınırlar

- **Android/iOS:** Expo Development Build tabanlı tam mobil çalışma alanı.
- **Windows 10/11:** Tauri tabanlı not, görev, proje özeti, Today, takvim ve GitHub iş akışları.
- **MCP:** OAuth, scope, revision, idempotency ve audit kayıtları olan provider-neutral servis.

Windows henüz mobil proje düzenleme/Kanban, çizim, çöp, revision ve conflict UI parity’sine sahip
değildir. macOS/Linux masaüstü uygulamaları desteklenmez. Native hatırlatıcı, harici takvim hesabı
ve davet bu sürümde yoktur.

Android Glance ve iOS WidgetKit için Bugünün Görevleri, Ajanda, Odak ve Hızlı Yakalama widget’ları
bulunur. iOS ayrıca local ActivityKit tabanlı Kilit Ekranı Live Activity ve Dynamic Island
sunumlarını; Android ise izin kontrollü sürekli odak bildirimini içerir. Varsayılan gizlilik yalnızca
sayıları gösterir, native katman Firebase’e erişmez. Bunlar Expo Go yerine Development/Release Build
gerektirir; fiziksel cihaz ve iOS archive kabulü henüz beklemededir.

## Hızlı başlangıç

Gereksinimler: Node.js 22+, pnpm 11.17.0, Git; native build için ilgili platform toolchain’leri.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm verify:i18n
```

- [Geliştirme ve self-hosting](public-docs/SELF-HOSTING.md)
- [Firebase ve güvenlik kuralları](public-docs/FIREBASE.md)
- [Windows, Android ve özel iOS build’leri](public-docs/BUILDS.md)
- [GitHub Device Flow](public-docs/GITHUB.md)
- [MCP kurulumu](services/mcp/README.md)
- [Yedekleme, restore, güncelleme ve sorun giderme](public-docs/OPERATIONS.md)
- [i18n katkı rehberi](public-docs/I18N.md)

## Katkı ve lisans

Katkıdan önce [CONTRIBUTING.md](CONTRIBUTING.md), ürün sınırları ve manuel doğrulama açıklarını
okuyun. Stone [MIT License](LICENSE) ile lisanslanır. Credential, kullanıcı içeriği veya yeniden
dağıtım hakkı olmayan varlıkları commit etmeyin.
