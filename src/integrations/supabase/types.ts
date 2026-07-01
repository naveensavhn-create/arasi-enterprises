export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          reason: string | null
          role_after: Database["public"]["Enums"]["app_role"] | null
          role_before: Database["public"]["Enums"]["app_role"] | null
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          role_after?: Database["public"]["Enums"]["app_role"] | null
          role_before?: Database["public"]["Enums"]["app_role"] | null
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          role_after?: Database["public"]["Enums"]["app_role"] | null
          role_before?: Database["public"]["Enums"]["app_role"] | null
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      draw_entries: {
        Row: {
          created_at: string
          customer_id: string
          disqualified_reason: string | null
          draw_id: string
          eligible: boolean
          entry_number: number
          id: string
          membership_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          disqualified_reason?: string | null
          draw_id: string
          eligible?: boolean
          entry_number?: number
          id?: string
          membership_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          disqualified_reason?: string | null
          draw_id?: string
          eligible?: boolean
          entry_number?: number
          id?: string
          membership_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draw_entries_draw_id_fkey"
            columns: ["draw_id"]
            isOneToOne: false
            referencedRelation: "draws"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draw_entries_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      draw_winners: {
        Row: {
          customer_id: string
          draw_id: string
          drawn_at: string
          drawn_by: string | null
          entry_id: string
          id: string
          notified_at: string | null
          position: number
          prize: string | null
          seed: string | null
        }
        Insert: {
          customer_id: string
          draw_id: string
          drawn_at?: string
          drawn_by?: string | null
          entry_id: string
          id?: string
          notified_at?: string | null
          position: number
          prize?: string | null
          seed?: string | null
        }
        Update: {
          customer_id?: string
          draw_id?: string
          drawn_at?: string
          drawn_by?: string | null
          entry_id?: string
          id?: string
          notified_at?: string | null
          position?: number
          prize?: string | null
          seed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draw_winners_draw_id_fkey"
            columns: ["draw_id"]
            isOneToOne: false
            referencedRelation: "draws"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draw_winners_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "draw_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      draws: {
        Row: {
          closes_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          draw_at: string | null
          drawn_at: string | null
          id: string
          mode: string
          name: string
          opens_at: string | null
          plan_id: string | null
          prize: string
          prize_value: number | null
          requires_active_membership: boolean
          seed: string | null
          status: Database["public"]["Enums"]["draw_status"]
          updated_at: string
          winners_count: number
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          draw_at?: string | null
          drawn_at?: string | null
          id?: string
          mode?: string
          name: string
          opens_at?: string | null
          plan_id?: string | null
          prize: string
          prize_value?: number | null
          requires_active_membership?: boolean
          seed?: string | null
          status?: Database["public"]["Enums"]["draw_status"]
          updated_at?: string
          winners_count?: number
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          draw_at?: string | null
          drawn_at?: string | null
          id?: string
          mode?: string
          name?: string
          opens_at?: string | null
          plan_id?: string | null
          prize?: string
          prize_value?: number | null
          requires_active_membership?: boolean
          seed?: string | null
          status?: Database["public"]["Enums"]["draw_status"]
          updated_at?: string
          winners_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "draws_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          attempts: number
          byte_size: number | null
          created_at: string
          error: string | null
          expires_at: string | null
          filters: Json
          finished_at: string | null
          id: string
          kind: string
          notified_at: string | null
          requested_by: string
          row_count: number | null
          started_at: string | null
          status: string
          storage_path: string | null
        }
        Insert: {
          attempts?: number
          byte_size?: number | null
          created_at?: string
          error?: string | null
          expires_at?: string | null
          filters?: Json
          finished_at?: string | null
          id?: string
          kind?: string
          notified_at?: string | null
          requested_by: string
          row_count?: number | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
        }
        Update: {
          attempts?: number
          byte_size?: number | null
          created_at?: string
          error?: string | null
          expires_at?: string | null
          filters?: Json
          finished_at?: string | null
          id?: string
          kind?: string
          notified_at?: string | null
          requested_by?: string
          row_count?: number | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
        }
        Relationships: []
      }
      installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          membership_id: string
          notes: string | null
          paid_amount: number
          paid_at: string | null
          payment_id: string | null
          payment_reference: string | null
          sequence: number
          status: Database["public"]["Enums"]["installment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          membership_id: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_id?: string | null
          payment_reference?: string | null
          sequence: number
          status?: Database["public"]["Enums"]["installment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          membership_id?: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_id?: string | null
          payment_reference?: string | null
          sequence?: number
          status?: Database["public"]["Enums"]["installment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installments_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_email_notifications: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          is_test: boolean
          membership_id: string | null
          message_id: string | null
          metadata: Json | null
          payment_id: string | null
          recipient_email: string
          status: string
          subject: string | null
          template_name: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          is_test?: boolean
          membership_id?: string | null
          message_id?: string | null
          metadata?: Json | null
          payment_id?: string | null
          recipient_email: string
          status?: string
          subject?: string | null
          template_name: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          is_test?: boolean
          membership_id?: string | null
          message_id?: string | null
          metadata?: Json | null
          payment_id?: string | null
          recipient_email?: string
          status?: string
          subject?: string | null
          template_name?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_email_notifications_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_email_notifications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_plans: {
        Row: {
          advance_amount: number
          benefits: Json
          created_at: string
          description: string | null
          display_order: number
          duration_months: number
          id: string
          is_active: boolean
          monthly_installment: number
          name: string
          total_value: number | null
          updated_at: string
        }
        Insert: {
          advance_amount?: number
          benefits?: Json
          created_at?: string
          description?: string | null
          display_order?: number
          duration_months: number
          id?: string
          is_active?: boolean
          monthly_installment: number
          name: string
          total_value?: number | null
          updated_at?: string
        }
        Update: {
          advance_amount?: number
          benefits?: Json
          created_at?: string
          description?: string | null
          display_order?: number
          duration_months?: number
          id?: string
          is_active?: boolean
          monthly_installment?: number
          name?: string
          total_value?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          advance_paid: number
          coupon_no: string | null
          created_at: string
          end_date: string | null
          id: string
          member_display_id: string | null
          membership_number: string
          notes: string | null
          paid_amount: number
          plan_id: string
          promoter_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["membership_status"]
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          advance_paid?: number
          coupon_no?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          member_display_id?: string | null
          membership_number: string
          notes?: string | null
          paid_amount?: number
          plan_id: string
          promoter_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["membership_status"]
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          advance_paid?: number
          coupon_no?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          member_display_id?: string | null
          membership_number?: string
          notes?: string | null
          paid_amount?: number
          plan_id?: string
          promoter_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["membership_status"]
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliations: {
        Row: {
          checked_by: string | null
          created_at: string
          id: string
          mismatch: boolean
          note: string | null
          payment_id: string
          provider_amount: number | null
          provider_error: string | null
          provider_method: string | null
          provider_status: string | null
          resolved_at: string | null
          resolved_by: string | null
          stored_status: string
        }
        Insert: {
          checked_by?: string | null
          created_at?: string
          id?: string
          mismatch?: boolean
          note?: string | null
          payment_id: string
          provider_amount?: number | null
          provider_error?: string | null
          provider_method?: string | null
          provider_status?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          stored_status: string
        }
        Update: {
          checked_by?: string | null
          created_at?: string
          id?: string
          mismatch?: boolean
          note?: string | null
          payment_id?: string
          provider_amount?: number | null
          provider_error?: string | null
          provider_method?: string | null
          provider_status?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          stored_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reminder_jobs: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["reminder_channel"]
          created_at: string
          dead_letter_at: string | null
          dead_letter_reason: string | null
          error_code: string | null
          error_message: string | null
          id: string
          installment_id: string
          last_attempt_at: string | null
          max_attempts: number
          membership_id: string
          metadata: Json
          next_attempt_at: string | null
          provider: string | null
          provider_message_id: string | null
          recipient_email: string | null
          recipient_id: string
          recipient_phone: string | null
          reminder_kind: string
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel?: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          dead_letter_at?: string | null
          dead_letter_reason?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          installment_id: string
          last_attempt_at?: string | null
          max_attempts?: number
          membership_id: string
          metadata?: Json
          next_attempt_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          recipient_id: string
          recipient_phone?: string | null
          reminder_kind?: string
          scheduled_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          dead_letter_at?: string | null
          dead_letter_reason?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          installment_id?: string
          last_attempt_at?: string | null
          max_attempts?: number
          membership_id?: string
          metadata?: Json
          next_attempt_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          recipient_id?: string
          recipient_phone?: string | null
          reminder_kind?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reminder_jobs_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reminder_jobs_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          customer_id: string
          error_code: string | null
          error_description: string | null
          id: string
          installment_id: string | null
          membership_id: string
          method: string | null
          notes: Json | null
          paid_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_order_id: string | null
          provider_payment_id: string | null
          provider_signature: string | null
          raw_webhook: Json | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          customer_id: string
          error_code?: string | null
          error_description?: string | null
          id?: string
          installment_id?: string | null
          membership_id: string
          method?: string | null
          notes?: Json | null
          paid_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_order_id?: string | null
          provider_payment_id?: string | null
          provider_signature?: string | null
          raw_webhook?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          customer_id?: string
          error_code?: string | null
          error_description?: string | null
          id?: string
          installment_id?: string | null
          membership_id?: string
          method?: string | null
          notes?: Json | null
          paid_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_order_id?: string | null
          provider_payment_id?: string | null
          provider_signature?: string | null
          raw_webhook?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          changed_fields: string[] | null
          created_at: string
          id: string
          plan_code: string | null
          plan_id: string | null
          plan_name: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          plan_code?: string | null
          plan_id?: string | null
          plan_name?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          plan_code?: string | null
          plan_id?: string | null
          plan_name?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          aadhaar_address: string | null
          aadhaar_back_url: string | null
          aadhaar_front_url: string | null
          aadhaar_number: string | null
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          city: string | null
          country: string | null
          coupon_number: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          kyc_review_notes: string | null
          kyc_reviewed_at: string | null
          kyc_reviewed_by: string | null
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          kyc_submitted_at: string | null
          membership_id: string | null
          phone: string | null
          postal_code: string | null
          referred_by_promoter_id: string | null
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aadhaar_address?: string | null
          aadhaar_back_url?: string | null
          aadhaar_front_url?: string | null
          aadhaar_number?: string | null
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          coupon_number?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          kyc_review_notes?: string | null
          kyc_reviewed_at?: string | null
          kyc_reviewed_by?: string | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          kyc_submitted_at?: string | null
          membership_id?: string | null
          phone?: string | null
          postal_code?: string | null
          referred_by_promoter_id?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aadhaar_address?: string | null
          aadhaar_back_url?: string | null
          aadhaar_front_url?: string | null
          aadhaar_number?: string | null
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          coupon_number?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          kyc_review_notes?: string | null
          kyc_reviewed_at?: string | null
          kyc_reviewed_by?: string | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          kyc_submitted_at?: string | null
          membership_id?: string | null
          phone?: string | null
          postal_code?: string | null
          referred_by_promoter_id?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      razorpay_webhook_events: {
        Row: {
          event_id: string
          event_type: string | null
          id: string
          order_id: string | null
          payment_id: string | null
          processed_at: string
          raw: Json | null
          received_at: string
          status: string
        }
        Insert: {
          event_id: string
          event_type?: string | null
          id?: string
          order_id?: string | null
          payment_id?: string | null
          processed_at?: string
          raw?: Json | null
          received_at?: string
          status?: string
        }
        Update: {
          event_id?: string
          event_type?: string | null
          id?: string
          order_id?: string | null
          payment_id?: string | null
          processed_at?: string
          raw?: Json | null
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "razorpay_webhook_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      role_email_notifications: {
        Row: {
          audit_id: string | null
          created_at: string
          error_message: string | null
          id: string
          is_test: boolean
          message_id: string | null
          metadata: Json
          recipient_email: string
          status: string
          subject: string | null
          target_user_id: string | null
          template_name: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          audit_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_test?: boolean
          message_id?: string | null
          metadata?: Json
          recipient_email: string
          status?: string
          subject?: string | null
          target_user_id?: string | null
          template_name: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          audit_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_test?: boolean
          message_id?: string | null
          metadata?: Json
          recipient_email?: string
          status?: string
          subject?: string | null
          target_user_id?: string | null
          template_name?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_email_notifications_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "admin_audit_log"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          accent_color: string
          body_font: string
          brand_name: string
          favicon_url: string | null
          footer_text: string | null
          heading_font: string
          id: string
          logo_url: string | null
          primary_color: string
          secondary_color: string
          support_email: string | null
          support_phone: string | null
          tagline: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accent_color?: string
          body_font?: string
          brand_name?: string
          favicon_url?: string | null
          footer_text?: string | null
          heading_font?: string
          id?: string
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          support_email?: string | null
          support_phone?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accent_color?: string
          body_font?: string
          brand_name?: string
          favicon_url?: string | null
          footer_text?: string | null
          heading_font?: string
          id?: string
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          support_email?: string | null
          support_phone?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_ui_prefs: {
        Row: {
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_membership_after_advance: {
        Args: { _payment_id: string }
        Returns: undefined
      }
      admin_list_kyc: {
        Args: { _status?: string }
        Returns: {
          aadhaar_address: string
          aadhaar_back_url: string
          aadhaar_front_url: string
          aadhaar_number: string
          address_line1: string
          address_line2: string
          city: string
          country: string
          email: string
          full_name: string
          id: string
          kyc_review_notes: string
          kyc_reviewed_at: string
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          kyc_submitted_at: string
          phone: string
          postal_code: string
          referred_by_email: string
          referred_by_name: string
          referred_by_promoter_id: string
          role: Database["public"]["Enums"]["app_role"]
          state: string
        }[]
      }
      admin_list_promoters: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      admin_list_users: {
        Args: never
        Returns: {
          banned_until: string
          created_at: string
          email: string
          full_name: string
          id: string
          last_sign_in_at: string
          membership_number: string
          phone: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      admin_payments_totals: {
        Args: {
          _customer_ids?: string[]
          _customer_ids_exact?: string[]
          _from?: string
          _membership_ids?: string[]
          _order_id?: string
          _payment_id?: string
          _q?: string
          _status?: string
          _to?: string
        }
        Returns: {
          paid_count: number
          paid_sum: number
          total_count: number
        }[]
      }
      admin_set_customer_promoter: {
        Args: { _promoter_id: string; _user_id: string }
        Returns: undefined
      }
      admin_set_kyc_decision:
        | {
            Args: { _approve: boolean; _notes?: string; _user_id: string }
            Returns: undefined
          }
        | {
            Args: {
              _approve: boolean
              _assign_role?: Database["public"]["Enums"]["app_role"]
              _notes?: string
              _user_id: string
            }
            Returns: undefined
          }
      auto_pick_due_draws: { Args: never; Returns: number }
      claim_due_reminder_jobs: {
        Args: { _limit?: number }
        Returns: {
          attempts: number
          channel: Database["public"]["Enums"]["reminder_channel"]
          created_at: string
          dead_letter_at: string | null
          dead_letter_reason: string | null
          error_code: string | null
          error_message: string | null
          id: string
          installment_id: string
          last_attempt_at: string | null
          max_attempts: number
          membership_id: string
          metadata: Json
          next_attempt_at: string | null
          provider: string | null
          provider_message_id: string | null
          recipient_email: string | null
          recipient_id: string
          recipient_phone: string | null
          reminder_kind: string
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "payment_reminder_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      count_active_admins: { Args: never; Returns: number }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      finalize_reminder_job: {
        Args: {
          _error_code?: string
          _error_message?: string
          _job_id: string
          _metadata?: Json
          _provider?: string
          _provider_message_id?: string
          _retry_in_seconds?: number
          _status: string
        }
        Returns: {
          attempts: number
          channel: Database["public"]["Enums"]["reminder_channel"]
          created_at: string
          dead_letter_at: string | null
          dead_letter_reason: string | null
          error_code: string | null
          error_message: string | null
          id: string
          installment_id: string
          last_attempt_at: string | null
          max_attempts: number
          membership_id: string
          metadata: Json
          next_attempt_at: string | null
          provider: string | null
          provider_message_id: string | null
          recipient_email: string | null
          recipient_id: string
          recipient_phone: string | null
          reminder_kind: string
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_reminder_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_installment_paid: {
        Args: {
          _installment_id: string
          _paid_at?: string
          _payment_id: string
        }
        Returns: undefined
      }
      mark_overdue_installments: { Args: never; Returns: number }
      pick_draw_winners: {
        Args: { _draw_id: string; _seed?: string }
        Returns: {
          customer_id: string
          draw_id: string
          drawn_at: string
          drawn_by: string | null
          entry_id: string
          id: string
          notified_at: string | null
          position: number
          prize: string | null
          seed: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "draw_winners"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      promoter_list_my_customers: {
        Args: never
        Returns: {
          aadhaar_address: string
          address_line1: string
          address_line2: string
          city: string
          country: string
          coupon_no: string
          created_at: string
          email: string
          full_name: string
          id: string
          kyc_reviewed_at: string
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          kyc_submitted_at: string
          member_display_id: string
          membership_number: string
          membership_status: string
          phone: string
          postal_code: string
          state: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "promoter" | "customer"
      draw_status: "scheduled" | "open" | "closed" | "completed" | "cancelled"
      installment_status: "pending" | "paid" | "overdue" | "waived"
      kyc_status: "unsubmitted" | "pending" | "approved" | "rejected"
      membership_status:
        | "pending"
        | "active"
        | "completed"
        | "cancelled"
        | "defaulted"
      payment_provider: "razorpay" | "manual" | "cash"
      payment_status: "created" | "attempted" | "paid" | "failed" | "refunded"
      reminder_channel: "email" | "sms"
      reminder_status:
        | "pending"
        | "sending"
        | "sent"
        | "failed"
        | "cancelled"
        | "skipped"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "promoter", "customer"],
      draw_status: ["scheduled", "open", "closed", "completed", "cancelled"],
      installment_status: ["pending", "paid", "overdue", "waived"],
      kyc_status: ["unsubmitted", "pending", "approved", "rejected"],
      membership_status: [
        "pending",
        "active",
        "completed",
        "cancelled",
        "defaulted",
      ],
      payment_provider: ["razorpay", "manual", "cash"],
      payment_status: ["created", "attempted", "paid", "failed", "refunded"],
      reminder_channel: ["email", "sms"],
      reminder_status: [
        "pending",
        "sending",
        "sent",
        "failed",
        "cancelled",
        "skipped",
      ],
    },
  },
} as const
