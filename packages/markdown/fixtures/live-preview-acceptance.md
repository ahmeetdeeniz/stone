---
title: Stone kabul planı
tags:
  - stone
  - release
stone:
  schema: 1
  type: project
  id: project-goal-9b
  status: testing
  priority: high
  currentVersion: 1.0.0
  nextVersion: 1.0.1
  targetDate: 2026-08-15
  nextAction: Fiziksel cihaz kabulünü tamamla
---

# Stone Goal 9B — Türkçe kabul

Uzun bir paragraf içinde **kalın**, _italik_, `inline code`, #etiket,
[dış bağlantı](https://example.com) ve desteklenmeyen ama korunması gereken [[İç Bağlantı]] bulunur.

## Plan

1. Oturum geri yüklemeyi doğrula
2. Markdown görünümünü kontrol et
   1. İç içe sıralı öğe

- Normal öğe
  - İç içe öğe
- [ ] Açık görev
- [x] Tamamlanmış görev

<!-- stone-task: {"id":"task-done","priority":"high","due":"2026-08-01"} -->

-

> Sade blockquote metni.

> [!IMPORTANT] Kaynak korunmalı
> Frontmatter ve görev işaretleri sessizce değişmemeli.

| Yüzey   | Durum    |
| ------- | -------- |
| Desktop | Otomatik |
| Tablet  | Manuel   |

```ts
const markdown: string = "kaynak";
```

---

Bu_satır_çok_uzun_olmasına_rağmen_yatay_veya_kelime_kaydırma_davranışıyla_düzenlenebilir_kalmalı_ve_kaynak_içeriği_sessizce_değiştirilmemelidir.
