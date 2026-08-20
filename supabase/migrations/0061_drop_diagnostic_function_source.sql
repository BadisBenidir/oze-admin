-- ============================================================================
-- Nettoyage : supprime debug_function_source (0059), un helper de diagnostic
-- temporaire utilisé pour lire la définition exacte de confirm_b2b_payment et
-- pay_b2b_order_with_wallet avant de les modifier chirurgicalement (0060).
-- ============================================================================

drop function if exists public.debug_function_source(text);

notify pgrst, 'reload schema';
