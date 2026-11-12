-- document-service: foreign-keys. Load order comes from scripts/db-files.mjs.

--
-- Name: cash_sale_items cash_sale_items_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sale_items
    ADD CONSTRAINT cash_sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.cash_sales(id) ON DELETE CASCADE;



--
-- Name: grn_items grn_items_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.grns(id) ON DELETE CASCADE;



--
-- Name: grn_items grn_items_po_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_po_item_id_fkey FOREIGN KEY (po_item_id) REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT;



--
-- Name: grn_items grn_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;



--
-- Name: grn_items grn_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;



--
-- Name: grns grns_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;



--
-- Name: grns grns_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;



--
-- Name: inventory_transactions inventory_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);



--
-- Name: inventory_transactions inventory_transactions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;



--
-- Name: inventory_transactions inventory_transactions_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE CASCADE;



--
-- Name: inventory_transactions inventory_transactions_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.product_units(id) ON DELETE SET NULL;



--
-- Name: inventory_transactions inventory_transactions_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;



--
-- Name: invoices invoices_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;



--
-- Name: invoices invoices_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.cash_sales(id) ON DELETE CASCADE;



--
-- Name: purchase_order_items purchase_order_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;



--
-- Name: purchase_order_items purchase_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;



--
-- Name: purchase_order_items purchase_order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE RESTRICT;


--
-- Name: purchase_order_items purchase_order_items_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE RESTRICT;



--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;



--
-- Name: quotation_items quotation_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;



--
-- Name: quotation_items quotation_items_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON DELETE CASCADE;



--
-- Name: quotation_items quotation_items_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE SET NULL;



--
-- Name: quotation_items quotation_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;



--
-- Name: quotations quotations_converted_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_converted_order_id_fkey FOREIGN KEY (converted_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;



--
-- Name: quotations quotations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: shelf_locations shelf_locations_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_locations
    ADD CONSTRAINT shelf_locations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;



--
-- Name: shelf_stock_transactions shelf_stock_transactions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock_transactions
    ADD CONSTRAINT shelf_stock_transactions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.shelf_locations(id) ON DELETE SET NULL;



--
-- Name: shelf_stock_transactions shelf_stock_transactions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock_transactions
    ADD CONSTRAINT shelf_stock_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);



--
-- Name: shelf_stock_transactions shelf_stock_transactions_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock_transactions
    ADD CONSTRAINT shelf_stock_transactions_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE SET NULL;



--
-- Name: shelf_stock_transactions shelf_stock_transactions_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shelf_stock_transactions
    ADD CONSTRAINT shelf_stock_transactions_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.drive_files
    ADD CONSTRAINT drive_files_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.drive_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.drive_shares
    ADD CONSTRAINT drive_shares_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.drive_folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.drive_shares
    ADD CONSTRAINT drive_shares_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.drive_files(id) ON DELETE CASCADE;
ALTER TABLE shelf_stock_transactions DROP CONSTRAINT IF EXISTS shelf_stock_transactions_location_id_fkey;
ALTER TABLE shelf_stock_transactions ADD CONSTRAINT shelf_stock_transactions_location_id_fkey FOREIGN KEY (location_id) REFERENCES shelf_locations(id) ON DELETE SET NULL;
