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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      caregiver_invites: {
        Row: {
          code: string
          created_at: string
          elder_id: string
          expires_at: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          elder_id: string
          expires_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          elder_id?: string
          expires_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      caregiver_links: {
        Row: {
          caregiver_id: string
          created_at: string
          elder_id: string
          id: string
        }
        Insert: {
          caregiver_id: string
          created_at?: string
          elder_id: string
          id?: string
        }
        Update: {
          caregiver_id?: string
          created_at?: string
          elder_id?: string
          id?: string
        }
        Relationships: []
      }
      device_events: {
        Row: {
          created_at: string
          device_id: string
          event_type: string
          id: string
          owner_id: string
          payload: Json
          source: Database["public"]["Enums"]["device_mode"]
        }
        Insert: {
          created_at?: string
          device_id: string
          event_type: string
          id?: string
          owner_id: string
          payload?: Json
          source: Database["public"]["Enums"]["device_mode"]
        }
        Update: {
          created_at?: string
          device_id?: string
          event_type?: string
          id?: string
          owner_id?: string
          payload?: Json
          source?: Database["public"]["Enums"]["device_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "device_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_keys: {
        Row: {
          created_at: string
          device_id: string
          key_hash: string
        }
        Insert: {
          created_at?: string
          device_id: string
          key_hash: string
        }
        Update: {
          created_at?: string
          device_id?: string
          key_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_keys_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          firmware: string | null
          first_contact_at: string | null
          id: string
          key_prefix: string | null
          last_seen_at: string | null
          last_status: Json
          mode: Database["public"]["Enums"]["device_mode"]
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          firmware?: string | null
          first_contact_at?: string | null
          id?: string
          key_prefix?: string | null
          last_seen_at?: string | null
          last_status?: Json
          mode: Database["public"]["Enums"]["device_mode"]
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          firmware?: string | null
          first_contact_at?: string | null
          id?: string
          key_prefix?: string | null
          last_seen_at?: string | null
          last_status?: Json
          mode?: Database["public"]["Enums"]["device_mode"]
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      dose_logs: {
        Row: {
          confirmed_at: string
          confirmed_by: string | null
          created_at: string
          device_id: string | null
          id: string
          medicine_id: string
          owner_id: string
          schedule_id: string | null
          scheduled_date: string
          slot: Database["public"]["Enums"]["time_slot"]
          source: Database["public"]["Enums"]["dose_source"]
        }
        Insert: {
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          medicine_id: string
          owner_id: string
          schedule_id?: string | null
          scheduled_date: string
          slot: Database["public"]["Enums"]["time_slot"]
          source?: Database["public"]["Enums"]["dose_source"]
        }
        Update: {
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          medicine_id?: string
          owner_id?: string
          schedule_id?: string | null
          scheduled_date?: string
          slot?: Database["public"]["Enums"]["time_slot"]
          source?: Database["public"]["Enums"]["dose_source"]
        }
        Relationships: [
          {
            foreignKeyName: "dose_logs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_logs_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dose_logs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "medication_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_schedules: {
        Row: {
          created_at: string
          days_of_week: number[]
          dose_time: string
          id: string
          medicine_id: string
          notify: boolean
          owner_id: string
          slot: Database["public"]["Enums"]["time_slot"]
        }
        Insert: {
          created_at?: string
          days_of_week?: number[]
          dose_time: string
          id?: string
          medicine_id: string
          notify?: boolean
          owner_id: string
          slot: Database["public"]["Enums"]["time_slot"]
        }
        Update: {
          created_at?: string
          days_of_week?: number[]
          dose_time?: string
          id?: string
          medicine_id?: string
          notify?: boolean
          owner_id?: string
          slot?: Database["public"]["Enums"]["time_slot"]
        }
        Relationships: [
          {
            foreignKeyName: "medication_schedules_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          active: boolean
          color: string
          compartment: number | null
          created_at: string
          dosage: string | null
          food_instruction: Database["public"]["Enums"]["food_instruction"]
          id: string
          name: string
          notes: string | null
          owner_id: string
          pills_per_dose: number
          quantity: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          compartment?: number | null
          created_at?: string
          dosage?: string | null
          food_instruction?: Database["public"]["Enums"]["food_instruction"]
          id?: string
          name: string
          notes?: string | null
          owner_id: string
          pills_per_dose?: number
          quantity?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          compartment?: number | null
          created_at?: string
          dosage?: string | null
          food_instruction?: Database["public"]["Enums"]["food_instruction"]
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string
          pills_per_dose?: number
          quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          preferred_language: string
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          phone?: string | null
          preferred_language?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          preferred_language?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_caregiver_invite: { Args: { _code: string }; Returns: string }
      can_access: { Args: { _owner: string }; Returns: boolean }
      is_linked: { Args: { _other: string }; Returns: boolean }
    }
    Enums: {
      device_mode: "real" | "simulated"
      dose_source: "app" | "caregiver" | "device" | "simulated"
      food_instruction: "before_food" | "after_food" | "with_food" | "any"
      time_slot: "morning" | "afternoon" | "evening" | "bedtime"
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
      device_mode: ["real", "simulated"],
      dose_source: ["app", "caregiver", "device", "simulated"],
      food_instruction: ["before_food", "after_food", "with_food", "any"],
      time_slot: ["morning", "afternoon", "evening", "bedtime"],
    },
  },
} as const
