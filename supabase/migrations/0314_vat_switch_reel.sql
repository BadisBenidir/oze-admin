-- Active le régime miniréel (assujetti depuis le 20/05/2026, voir 0313).
-- À appliquer en même temps que la mise en ligne de l'admin qui le gère :
-- l'ancienne version ne connaît pas le régime 'reel' (elle afficherait
-- alors « franchise » partout).
-- Annulation : update public.vat_settings set regime = 'assujetti' where id;
update public.vat_settings
set regime = 'reel',
    liability_start_at = coalesce(liability_start_at, timestamptz '2026-05-20 00:00:00 Europe/Paris'),
    note = 'Miniréel (réel normal TVA, CA3 mensuelle) depuis le 20/05/2026, début d''activité. TVA facturée depuis le 06/11/2026 20:11 (Paris).'
where id;
