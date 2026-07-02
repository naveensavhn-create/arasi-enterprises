
CREATE POLICY "brand_assets_admin_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "brand_assets_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "brand_assets_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "brand_assets_admin_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));
