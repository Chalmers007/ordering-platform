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
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_fields: string[] | null
          created_at: string
          id: number
          impersonated: boolean
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          operation: string | null
          record_id: string | null
          table_name: string
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          changed_fields?: string[] | null
          created_at?: string
          id?: never
          impersonated?: boolean
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          operation?: string | null
          record_id?: string | null
          table_name: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          changed_fields?: string[] | null
          created_at?: string
          id?: never
          impersonated?: boolean
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          operation?: string | null
          record_id?: string | null
          table_name?: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_address_line1: string | null
          delivery_address_line2: string | null
          delivery_city: string | null
          delivery_country: string | null
          delivery_instructions: string | null
          delivery_latitude: number | null
          delivery_longitude: number | null
          delivery_postal_code: string | null
          delivery_region: string | null
          expires_at: string
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          order_id: string | null
          priced_cart: Json
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_payment_intent_id: string | null
          provider_session_id: string | null
          status: Database["public"]["Enums"]["checkout_session_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_instructions?: string | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          delivery_postal_code?: string | null
          delivery_region?: string | null
          expires_at?: string
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          order_id?: string | null
          priced_cart: Json
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_intent_id?: string | null
          provider_session_id?: string | null
          status?: Database["public"]["Enums"]["checkout_session_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_instructions?: string | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          delivery_postal_code?: string | null
          delivery_region?: string | null
          expires_at?: string
          fulfillment_type?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          order_id?: string | null
          priced_cart?: Json
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_intent_id?: string | null
          provider_session_id?: string | null
          status?: Database["public"]["Enums"]["checkout_session_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_rewards: {
        Row: {
          amount_cents: number
          expires_at: string | null
          granted_at: string
          granted_for_order_id: string | null
          id: string
          kind: string
          redeemed_at: string | null
          redeemed_on_order_id: string | null
          status: Database["public"]["Enums"]["reward_status"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          expires_at?: string | null
          granted_at?: string
          granted_for_order_id?: string | null
          id?: string
          kind: string
          redeemed_at?: string | null
          redeemed_on_order_id?: string | null
          status?: Database["public"]["Enums"]["reward_status"]
          tenant_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          expires_at?: string | null
          granted_at?: string
          granted_for_order_id?: string | null
          id?: string
          kind?: string
          redeemed_at?: string | null
          redeemed_on_order_id?: string | null
          status?: Database["public"]["Enums"]["reward_status"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_rewards_granted_for_order_id_fkey"
            columns: ["granted_for_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_rewards_redeemed_on_order_id_fkey"
            columns: ["redeemed_on_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_rewards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          assigned_at: string | null
          cost_cents: number | null
          courier_heading: number | null
          courier_latitude: number | null
          courier_longitude: number | null
          courier_name: string | null
          courier_phone: string | null
          courier_photo_url: string | null
          created_at: string
          delivered_at: string | null
          distance_meters: number | null
          estimated_delivery_at: string | null
          estimated_pickup_at: string | null
          external_ref: string | null
          failure_reason: string | null
          id: string
          location_updated_at: string | null
          order_id: string
          picked_up_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          cost_cents?: number | null
          courier_heading?: number | null
          courier_latitude?: number | null
          courier_longitude?: number | null
          courier_name?: string | null
          courier_phone?: string | null
          courier_photo_url?: string | null
          created_at?: string
          delivered_at?: string | null
          distance_meters?: number | null
          estimated_delivery_at?: string | null
          estimated_pickup_at?: string | null
          external_ref?: string | null
          failure_reason?: string | null
          id?: string
          location_updated_at?: string | null
          order_id: string
          picked_up_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          cost_cents?: number | null
          courier_heading?: number | null
          courier_latitude?: number | null
          courier_longitude?: number | null
          courier_name?: string | null
          courier_phone?: string | null
          courier_photo_url?: string | null
          created_at?: string
          delivered_at?: string | null
          distance_meters?: number | null
          estimated_delivery_at?: string | null
          estimated_pickup_at?: string | null
          external_ref?: string | null
          failure_reason?: string | null
          id?: string
          location_updated_at?: string | null
          order_id?: string
          picked_up_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_order_fk"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_sessions: {
        Row: {
          ended_at: string | null
          id: string
          reason: string | null
          started_at: string
          super_admin_id: string
          tenant_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          reason?: string | null
          started_at?: string
          super_admin_id: string
          tenant_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          reason?: string | null
          started_at?: string
          super_admin_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_webhook_events: {
        Row: {
          attempts: number
          error: string | null
          event_id: string
          event_type: string
          id: string
          order_id: string | null
          payload: Json
          processed_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          received_at: string
          tenant_id: string | null
        }
        Insert: {
          attempts?: number
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          order_id?: string | null
          payload: Json
          processed_at?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
          tenant_id?: string | null
        }
        Update: {
          attempts?: number
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          order_id?: string | null
          payload?: Json
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_webhook_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          available_from: string | null
          available_to: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_modifier_groups: {
        Row: {
          created_at: string
          group_id: string
          id: string
          item_id: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          item_id: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          item_id?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_modifier_groups_group_fk"
            columns: ["group_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "menu_modifier_groups"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_item_fk"
            columns: ["item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: string[]
          calories: number | null
          category_id: string | null
          compare_at_cents: number | null
          cost_cents: number | null
          created_at: string
          description: string | null
          dietary_tags: string[]
          id: string
          image_path: string | null
          is_alcohol: boolean
          is_available: boolean
          is_featured: boolean
          is_taxable: boolean
          name: string
          prep_time_mins: number | null
          price_cents: number
          sku: string | null
          slug: string
          sort_order: number
          spice_level: number | null
          stock_quantity: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allergens?: string[]
          calories?: number | null
          category_id?: string | null
          compare_at_cents?: number | null
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          dietary_tags?: string[]
          id?: string
          image_path?: string | null
          is_alcohol?: boolean
          is_available?: boolean
          is_featured?: boolean
          is_taxable?: boolean
          name: string
          prep_time_mins?: number | null
          price_cents: number
          sku?: string | null
          slug: string
          sort_order?: number
          spice_level?: number | null
          stock_quantity?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allergens?: string[]
          calories?: number | null
          category_id?: string | null
          compare_at_cents?: number | null
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          dietary_tags?: string[]
          id?: string
          image_path?: string | null
          is_alcohol?: boolean
          is_available?: boolean
          is_featured?: boolean
          is_taxable?: boolean
          name?: string
          prep_time_mins?: number | null
          price_cents?: number
          sku?: string | null
          slug?: string
          sort_order?: number
          spice_level?: number | null
          stock_quantity?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_same_tenant_fk"
            columns: ["category_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifier_groups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_required: boolean
          max_selections: number | null
          min_selections: number
          name: string
          selection_type: Database["public"]["Enums"]["modifier_selection_type"]
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          max_selections?: number | null
          min_selections?: number
          name: string
          selection_type?: Database["public"]["Enums"]["modifier_selection_type"]
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          max_selections?: number | null
          min_selections?: number
          name?: string
          selection_type?: Database["public"]["Enums"]["modifier_selection_type"]
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifier_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifiers: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_available: boolean
          is_default: boolean
          name: string
          price_delta_cents: number
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_available?: boolean
          is_default?: boolean
          name: string
          price_delta_cents?: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_available?: boolean
          is_default?: boolean
          name?: string
          price_delta_cents?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifiers_group_same_tenant_fk"
            columns: ["group_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "menu_modifier_groups"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "menu_modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          created_at: string
          group_name_snapshot: string | null
          id: string
          modifier_id: string | null
          name_snapshot: string
          order_item_id: string
          price_delta_cents: number
          quantity: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          group_name_snapshot?: string | null
          id?: string
          modifier_id?: string | null
          name_snapshot: string
          order_item_id: string
          price_delta_cents?: number
          quantity?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          group_name_snapshot?: string | null
          id?: string
          modifier_id?: string | null
          name_snapshot?: string
          order_item_id?: string
          price_delta_cents?: number
          quantity?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_item_fk"
            columns: ["order_item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "menu_modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total_cents: number
          menu_item_id: string | null
          modifiers_total_cents: number
          name_snapshot: string
          notes: string | null
          order_id: string
          quantity: number
          sort_order: number
          tenant_id: string
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total_cents: number
          menu_item_id?: string | null
          modifiers_total_cents?: number
          name_snapshot: string
          notes?: string | null
          order_id: string
          quantity: number
          sort_order?: number
          tenant_id: string
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total_cents?: number
          menu_item_id?: string | null
          modifiers_total_cents?: number
          name_snapshot?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          sort_order?: number
          tenant_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_fk"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: string
          note: string | null
          order_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          note?: string | null
          order_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          note?: string | null
          order_id?: string
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_order_fk"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "order_status_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          application_fee_cents: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string
          customer_phone: string
          customer_user_id: string | null
          delivery_address_line1: string | null
          delivery_address_line2: string | null
          delivery_city: string | null
          delivery_country: string | null
          delivery_fee_cents: number
          delivery_instructions: string | null
          delivery_latitude: number | null
          delivery_longitude: number | null
          delivery_postal_code: string | null
          delivery_region: string | null
          discount_cents: number
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          is_first_time_customer: boolean
          notes: string | null
          order_number: string
          payment_charge_id: string | null
          payment_intent_id: string | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          prep_time_mins: number | null
          promised_at: string | null
          ready_at: string | null
          refunded_cents: number
          service_fee_cents: number
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          tax_cents: number
          tech_fee_cents: number
          tenant_id: string
          tip_cents: number
          total_cents: number
          tracking_token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          application_fee_cents?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          customer_user_id?: string | null
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_fee_cents?: number
          delivery_instructions?: string | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          delivery_postal_code?: string | null
          delivery_region?: string | null
          discount_cents?: number
          fulfillment_type?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          is_first_time_customer?: boolean
          notes?: string | null
          order_number: string
          payment_charge_id?: string | null
          payment_intent_id?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string | null
          prep_time_mins?: number | null
          promised_at?: string | null
          ready_at?: string | null
          refunded_cents?: number
          service_fee_cents?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          tax_cents?: number
          tech_fee_cents?: number
          tenant_id: string
          tip_cents?: number
          total_cents?: number
          tracking_token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          application_fee_cents?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          customer_user_id?: string | null
          delivery_address_line1?: string | null
          delivery_address_line2?: string | null
          delivery_city?: string | null
          delivery_country?: string | null
          delivery_fee_cents?: number
          delivery_instructions?: string | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          delivery_postal_code?: string | null
          delivery_region?: string | null
          discount_cents?: number
          fulfillment_type?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          is_first_time_customer?: boolean
          notes?: string | null
          order_number?: string
          payment_charge_id?: string | null
          payment_intent_id?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string | null
          prep_time_mins?: number | null
          promised_at?: string | null
          ready_at?: string | null
          refunded_cents?: number
          service_fee_cents?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          tax_cents?: number
          tech_fee_cents?: number
          tenant_id?: string
          tip_cents?: number
          total_cents?: number
          tracking_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_gateway_accounts: {
        Row: {
          account_type: string | null
          charges_enabled: boolean
          created_at: string
          details_submitted: boolean
          disconnect_reason: string | null
          external_account_id: string | null
          id: string
          is_default: boolean
          last_synced_at: string | null
          livemode: boolean
          metadata: Json
          payouts_enabled: boolean
          provider: Database["public"]["Enums"]["payment_provider"]
          status: Database["public"]["Enums"]["gateway_account_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_type?: string | null
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          disconnect_reason?: string | null
          external_account_id?: string | null
          id?: string
          is_default?: boolean
          last_synced_at?: string | null
          livemode?: boolean
          metadata?: Json
          payouts_enabled?: boolean
          provider: Database["public"]["Enums"]["payment_provider"]
          status?: Database["public"]["Enums"]["gateway_account_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_type?: string | null
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          disconnect_reason?: string | null
          external_account_id?: string | null
          id?: string
          is_default?: boolean
          last_synced_at?: string | null
          livemode?: boolean
          metadata?: Json
          payouts_enabled?: boolean
          provider?: Database["public"]["Enums"]["payment_provider"]
          status?: Database["public"]["Enums"]["gateway_account_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_gateway_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_subdomains: {
        Row: {
          reason: string
          slug: string
        }
        Insert: {
          reason: string
          slug: string
        }
        Update: {
          reason?: string
          slug?: string
        }
        Relationships: []
      }
      tenant_domains: {
        Row: {
          created_at: string
          hostname: string
          id: string
          is_primary: boolean
          ssl_issued_at: string | null
          tenant_id: string
          updated_at: string
          verification_token: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          hostname: string
          id?: string
          is_primary?: boolean
          ssl_issued_at?: string | null
          tenant_id: string
          updated_at?: string
          verification_token?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          hostname?: string
          id?: string
          is_primary?: boolean
          ssl_issued_at?: string | null
          tenant_id?: string
          updated_at?: string
          verification_token?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_order_counters: {
        Row: {
          last_number: number
          tenant_id: string
        }
        Insert: {
          last_number?: number
          tenant_id: string
        }
        Update: {
          last_number?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_order_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_secrets: {
        Row: {
          created_at: string
          key: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_secrets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          accepts_delivery: boolean
          accepts_pickup: boolean
          address_line1: string | null
          address_line2: string | null
          background_color: string
          brand_accent_color: string
          brand_primary_color: string
          business_hours: Json
          city: string | null
          country: string
          cover_image_url: string | null
          created_at: string
          default_tip_bps: number
          delivery_fee_cents: number
          delivery_minimum_cents: number
          delivery_radius_meters: number
          description: string | null
          estimated_prep_time_mins: number
          font_family: string
          is_kitchen_paused: boolean
          kitchen_paused_at: string | null
          kitchen_paused_reason: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          postal_code: string | null
          region: string | null
          service_fee_bps: number
          tagline: string | null
          tax_rate_bps: number
          tech_fee_cents: number
          tech_fee_enabled: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accepts_delivery?: boolean
          accepts_pickup?: boolean
          address_line1?: string | null
          address_line2?: string | null
          background_color?: string
          brand_accent_color?: string
          brand_primary_color?: string
          business_hours?: Json
          city?: string | null
          country?: string
          cover_image_url?: string | null
          created_at?: string
          default_tip_bps?: number
          delivery_fee_cents?: number
          delivery_minimum_cents?: number
          delivery_radius_meters?: number
          description?: string | null
          estimated_prep_time_mins?: number
          font_family?: string
          is_kitchen_paused?: boolean
          kitchen_paused_at?: string | null
          kitchen_paused_reason?: string | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          postal_code?: string | null
          region?: string | null
          service_fee_bps?: number
          tagline?: string | null
          tax_rate_bps?: number
          tech_fee_cents?: number
          tech_fee_enabled?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accepts_delivery?: boolean
          accepts_pickup?: boolean
          address_line1?: string | null
          address_line2?: string | null
          background_color?: string
          brand_accent_color?: string
          brand_primary_color?: string
          business_hours?: Json
          city?: string | null
          country?: string
          cover_image_url?: string | null
          created_at?: string
          default_tip_bps?: number
          delivery_fee_cents?: number
          delivery_minimum_cents?: number
          delivery_radius_meters?: number
          description?: string | null
          estimated_prep_time_mins?: number
          font_family?: string
          is_kitchen_paused?: boolean
          kitchen_paused_at?: string | null
          kitchen_paused_reason?: string | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          postal_code?: string | null
          region?: string | null
          service_fee_bps?: number
          tagline?: string | null
          tax_rate_bps?: number
          tech_fee_cents?: number
          tech_fee_enabled?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          claim_token: string | null
          claim_token_expires_at: string | null
          claimed_at: string | null
          created_at: string
          currency: string
          id: string
          legal_name: string | null
          locale: string
          name: string
          onboarded_at: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          support_email: string | null
          support_phone: string | null
          suspended_at: string | null
          suspended_reason: string | null
          timezone: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          claim_token?: string | null
          claim_token_expires_at?: string | null
          claimed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          legal_name?: string | null
          locale?: string
          name: string
          onboarded_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          support_email?: string | null
          support_phone?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          claim_token?: string | null
          claim_token_expires_at?: string | null
          claimed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          legal_name?: string | null
          locale?: string
          name?: string
          onboarded_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          support_email?: string | null
          support_phone?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_seen_at: string | null
          marketing_opt_in: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_seen_at?: string | null
          marketing_opt_in?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          marketing_opt_in?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: Database["public"]["Enums"]["webhook_event_type"]
          id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          order_id: string | null
          payload: Json
          response_status: number | null
          status: Database["public"]["Enums"]["webhook_delivery_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: Database["public"]["Enums"]["webhook_event_type"]
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          order_id?: string | null
          payload: Json
          response_status?: number | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: Database["public"]["Enums"]["webhook_event_type"]
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          order_id?: string | null
          payload?: Json
          response_status?: number | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      active_impersonation: {
        Args: never
        Returns: {
          session_id: string
          started_at: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      adjust_prep_time: {
        Args: { p_delta_mins: number; p_tenant_id: string }
        Returns: {
          accepts_delivery: boolean
          accepts_pickup: boolean
          address_line1: string | null
          address_line2: string | null
          background_color: string
          brand_accent_color: string
          brand_primary_color: string
          business_hours: Json
          city: string | null
          country: string
          cover_image_url: string | null
          created_at: string
          default_tip_bps: number
          delivery_fee_cents: number
          delivery_minimum_cents: number
          delivery_radius_meters: number
          description: string | null
          estimated_prep_time_mins: number
          font_family: string
          is_kitchen_paused: boolean
          kitchen_paused_at: string | null
          kitchen_paused_reason: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          postal_code: string | null
          region: string | null
          service_fee_bps: number
          tagline: string | null
          tax_rate_bps: number
          tech_fee_cents: number
          tech_fee_enabled: boolean
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      advance_order_status: {
        Args: {
          p_note?: string
          p_order_id: string
          p_to_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: {
          accepted_at: string | null
          application_fee_cents: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string
          customer_phone: string
          customer_user_id: string | null
          delivery_address_line1: string | null
          delivery_address_line2: string | null
          delivery_city: string | null
          delivery_country: string | null
          delivery_fee_cents: number
          delivery_instructions: string | null
          delivery_latitude: number | null
          delivery_longitude: number | null
          delivery_postal_code: string | null
          delivery_region: string | null
          discount_cents: number
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          is_first_time_customer: boolean
          notes: string | null
          order_number: string
          payment_charge_id: string | null
          payment_intent_id: string | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          prep_time_mins: number | null
          promised_at: string | null
          ready_at: string | null
          refunded_cents: number
          service_fee_cents: number
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          tax_cents: number
          tech_fee_cents: number
          tenant_id: string
          tip_cents: number
          total_cents: number
          tracking_token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_tenant_owner: {
        Args: {
          p_email?: string
          p_full_name?: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_seen_at: string | null
          marketing_opt_in: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attach_audit_trigger: { Args: { p_table: unknown }; Returns: undefined }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      auth_tenant_id: { Args: never; Returns: string }
      can_manage_tenant: { Args: { p_tenant_id: string }; Returns: boolean }
      claim_tenant: {
        Args: {
          p_email: string
          p_full_name?: string
          p_phone?: string
          p_token: string
          p_user_id: string
        }
        Returns: {
          claim_token: string | null
          claim_token_expires_at: string | null
          claimed_at: string | null
          created_at: string
          currency: string
          id: string
          legal_name: string | null
          locale: string
          name: string
          onboarded_at: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          support_email: string | null
          support_phone: string | null
          suspended_at: string | null
          suspended_reason: string | null
          timezone: string
          trial_ends_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_customer_account: {
        Args: {
          p_email?: string
          p_full_name?: string
          p_marketing_opt_in?: boolean
          p_order_id?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      create_order_from_checkout: {
        Args: {
          p_application_fee_cents?: number
          p_charge_id?: string
          p_payment_intent_id?: string
          p_session_id: string
        }
        Returns: string
      }
      end_impersonation: { Args: never; Returns: number }
      get_delivery_tracking: {
        Args: { p_order_id?: string; p_token?: string }
        Returns: {
          completed_at: string
          delivery_status: Database["public"]["Enums"]["delivery_status"]
          driver_name: string
          driver_phone: string
          estimated_delivery_at: string
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          has_external_ref: boolean
          heading: number
          latitude: number
          location_updated_at: string
          longitude: number
          order_id: string
          order_number: string
          order_status: Database["public"]["Enums"]["order_status"]
          placed_at: string
          promised_at: string
          tenant_id: string
        }[]
      }
      get_order_by_tracking_token: {
        Args: { p_token: string }
        Returns: {
          completed_at: string
          courier_latitude: number
          courier_longitude: number
          courier_name: string
          currency: string
          customer_name: string
          delivery_fee_cents: number
          delivery_status: Database["public"]["Enums"]["delivery_status"]
          discount_cents: number
          estimated_delivery_at: string
          fulfillment_type: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          location_updated_at: string
          order_number: string
          placed_at: string
          promised_at: string
          service_fee_cents: number
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          tax_cents: number
          tech_fee_cents: number
          tenant_id: string
          tip_cents: number
          total_cents: number
        }[]
      }
      has_tenant_access: { Args: { p_tenant_id: string }; Returns: boolean }
      is_storefront_public: { Args: { p_tenant_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_member: { Args: { p_tenant_id: string }; Returns: boolean }
      is_tenant_owner: { Args: { p_tenant_id: string }; Returns: boolean }
      open_checkout_session: {
        Args: {
          p_cart: Json
          p_customer: Json
          p_delivery?: Json
          p_tenant_id: string
        }
        Returns: Json
      }
      platform_error_feed: {
        Args: { p_limit?: number }
        Returns: {
          detail: string
          occurred_at: string
          reference: string
          source: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      platform_metrics: {
        Args: never
        Returns: {
          active_dispatch_jobs: number
          active_tenants: number
          gmv_30d_cents: number
          gmv_cents: number
          open_kitchen_orders: number
          orders_30d: number
          orders_total: number
          past_due_tenants: number
          paused_kitchens: number
          pending_tenants: number
          platform_errors_24h: number
          suspended_tenants: number
          tech_fees_30d_cents: number
          tech_fees_cents: number
          total_tenants: number
        }[]
      }
      price_cart: { Args: { p_cart: Json; p_tenant_id: string }; Returns: Json }
      provision_tenant: {
        Args: {
          p_currency?: string
          p_name: string
          p_slug?: string
          p_support_email?: string
          p_support_phone?: string
          p_timezone?: string
          p_trial_days?: number
        }
        Returns: {
          claim_token: string | null
          claim_token_expires_at: string | null
          claimed_at: string | null
          created_at: string
          currency: string
          id: string
          legal_name: string | null
          locale: string
          name: string
          onboarded_at: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          support_email: string | null
          support_phone: string | null
          suspended_at: string | null
          suspended_reason: string | null
          timezone: string
          trial_ends_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_dispatch_reference: {
        Args: {
          p_estimated_delivery_at?: string
          p_estimated_pickup_at?: string
          p_external_ref: string
          p_order_id: string
          p_status?: Database["public"]["Enums"]["delivery_status"]
        }
        Returns: undefined
      }
      resolve_checkout_order: {
        Args: { p_session_id: string }
        Returns: {
          order_id: string
          session_status: Database["public"]["Enums"]["checkout_session_status"]
          tracking_token: string
        }[]
      }
      resolve_storefront: {
        Args: { p_hostname?: string; p_slug?: string }
        Returns: {
          is_custom_domain: boolean
          name: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          tenant_id: string
        }[]
      }
      safe_uuid: { Args: { p_text: string }; Returns: string }
      set_kitchen_pause: {
        Args: { p_paused: boolean; p_reason?: string; p_tenant_id: string }
        Returns: {
          accepts_delivery: boolean
          accepts_pickup: boolean
          address_line1: string | null
          address_line2: string | null
          background_color: string
          brand_accent_color: string
          brand_primary_color: string
          business_hours: Json
          city: string | null
          country: string
          cover_image_url: string | null
          created_at: string
          default_tip_bps: number
          delivery_fee_cents: number
          delivery_minimum_cents: number
          delivery_radius_meters: number
          description: string | null
          estimated_prep_time_mins: number
          font_family: string
          is_kitchen_paused: boolean
          kitchen_paused_at: string | null
          kitchen_paused_reason: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          postal_code: string | null
          region: string | null
          service_fee_bps: number
          tagline: string | null
          tax_rate_bps: number
          tech_fee_cents: number
          tech_fee_enabled: boolean
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      slugify_tenant_name: { Args: { p_name: string }; Returns: string }
      start_impersonation: {
        Args: { p_reason?: string; p_tenant_id: string }
        Returns: {
          ended_at: string | null
          id: string
          reason: string | null
          started_at: string
          super_admin_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "impersonation_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_claim_token: {
        Args: { p_token: string }
        Returns: {
          category_count: number
          expires_at: string
          item_count: number
          name: string
          slug: string
          tenant_id: string
        }[]
      }
    }
    Enums: {
      audit_action: "INSERT" | "UPDATE" | "DELETE"
      checkout_session_status: "open" | "completed" | "expired" | "cancelled"
      delivery_status:
        | "unassigned"
        | "assigned"
        | "picked_up"
        | "en_route"
        | "delivered"
        | "failed"
        | "cancelled"
      fulfillment_type: "delivery" | "pickup"
      gateway_account_status:
        | "pending"
        | "onboarding"
        | "active"
        | "restricted"
        | "disconnected"
      modifier_selection_type: "single" | "multiple"
      order_status:
        | "draft"
        | "pending_payment"
        | "paid"
        | "confirmed"
        | "preparing"
        | "ready"
        | "out_for_delivery"
        | "completed"
        | "cancelled"
        | "refunded"
      payment_provider: "stripe" | "square" | "paypal"
      payment_status:
        | "unpaid"
        | "processing"
        | "authorized"
        | "paid"
        | "failed"
        | "refunded"
        | "partially_refunded"
      reward_status: "granted" | "redeemed" | "expired" | "revoked"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "unpaid"
      tenant_status:
        | "pending"
        | "active"
        | "suspended"
        | "cancelled"
        | "pending_claim"
      user_role: "super_admin" | "tenant_owner" | "tenant_staff" | "customer"
      webhook_delivery_status:
        | "pending"
        | "delivering"
        | "delivered"
        | "failed"
        | "abandoned"
      webhook_event_type:
        | "order.created"
        | "order.first_time_customer"
        | "order.completed"
        | "order.cancelled"
        | "order.refunded"
        | "tenant.invited"
        | "tenant.provisioned"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      audit_action: ["INSERT", "UPDATE", "DELETE"],
      checkout_session_status: ["open", "completed", "expired", "cancelled"],
      delivery_status: [
        "unassigned",
        "assigned",
        "picked_up",
        "en_route",
        "delivered",
        "failed",
        "cancelled",
      ],
      fulfillment_type: ["delivery", "pickup"],
      gateway_account_status: [
        "pending",
        "onboarding",
        "active",
        "restricted",
        "disconnected",
      ],
      modifier_selection_type: ["single", "multiple"],
      order_status: [
        "draft",
        "pending_payment",
        "paid",
        "confirmed",
        "preparing",
        "ready",
        "out_for_delivery",
        "completed",
        "cancelled",
        "refunded",
      ],
      payment_provider: ["stripe", "square", "paypal"],
      payment_status: [
        "unpaid",
        "processing",
        "authorized",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
      ],
      reward_status: ["granted", "redeemed", "expired", "revoked"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "incomplete",
        "unpaid",
      ],
      tenant_status: [
        "pending",
        "active",
        "suspended",
        "cancelled",
        "pending_claim",
      ],
      user_role: ["super_admin", "tenant_owner", "tenant_staff", "customer"],
      webhook_delivery_status: [
        "pending",
        "delivering",
        "delivered",
        "failed",
        "abandoned",
      ],
      webhook_event_type: [
        "order.created",
        "order.first_time_customer",
        "order.completed",
        "order.cancelled",
        "order.refunded",
        "tenant.invited",
        "tenant.provisioned",
      ],
    },
  },
} as const
