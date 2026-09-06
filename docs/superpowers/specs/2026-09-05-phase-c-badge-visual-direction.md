# Phase C — Approved Badge Visual Direction

Date: 2026-09-05
Repository: `HughKinnett/anonchat`
Status: Approved visual companion to the Phase C design

This document records the badge art direction approved for the Phase C automatic milestone badge system. It supplements `2026-09-05-phase-c-messaging-settings-badges-design.md` and is binding for implementation planning.

## Overall visual language

AnonChat badges should look like collectible achievement emblems rather than flat text labels.

Approved direction:

- dark AnonChat-compatible presentation and UI context;
- glossy enamel / polished vector-emblem appearance;
- crisp metallic outlines and highlights;
- strong silhouette so a badge is recognizable at small profile-preview size;
- distinct visual identity per badge family;
- original AnonChat artwork and iconography, not copied from Reddit or another platform;
- progressive prestige as higher milestone tiers are reached;
- artwork suitable for both web and Android/TWA display.

## Approved badge families and visual motifs

1. **Early Member** — founding/early-supporter emblem, star/founding-date visual language.
2. **Account Age** — hourglass/time motif.
3. **Posts Created** — writing/post creation motif such as a quill, pencil, or post sheet.
4. **Comments Made** — conversation/speech-bubble motif.
5. **Reactions Received** — heart/reaction motif.
6. **Followers Reached** — people/community-growth motif.
7. **Community Participation** — connected people / community / globe-style motif.
8. **Top Contributor** — trophy/star/laurel prestige motif.

## Approved tier progression

Milestone families that use progressive levels should use these tier names:

1. **Spark** — entry milestone; restrained bronze/copper treatment.
2. **Pulse** — established activity; silver/steel treatment with added framing.
3. **Beacon** — high activity; gold treatment with stronger highlights/laurel/radiance.
4. **Legend** — highest standard tier; premium purple-and-gold treatment with crown/laurel/gem-style prestige details where appropriate.

The exact threshold values may vary by badge family, but the visual hierarchy should remain consistent: Spark < Pulse < Beacon < Legend.

## Profile presentation

- Profile badge preview should show actual badge artwork, not only names.
- Public badge previews are clickable and open the full earned-badge collection.
- Full collection view should preserve the badge artwork at a larger size and show badge name, family, tier, description, milestone requirement, and earned date when available.
- Higher-tier badges should remain visually distinguishable even when reduced to compact profile-preview size.
- `profilePrivacy.showBadges` continues to control whether other users can see or open the collection.

## Automatic-award relationship

The artwork is tied to built-in milestone definitions controlled by AnonChat code/config. Admins do not create the badge art, badge families, or normal milestone definitions from the dashboard.

Admin badge controls remain limited to:

- viewing earned badges;
- corrective removal for error/abuse;
- emergency disabling of future automatic awards.

## Accessibility requirements

Badge meaning must not rely on color alone. Each badge/tier should also be identifiable by at least one of:

- unique iconography;
- tier label;
- distinct frame/silhouette;
- accessible text description.

Text labels and detail views must remain legible under the approved High Contrast and larger text-size settings.

## Approved concept direction

The generated AnonChat badge concept boards shown during design review are accepted as the target style direction. They are concept references rather than production-ready raster assets; implementation should create/export optimized individual badge assets that preserve this visual language and scale cleanly in profile previews and full badge views.
