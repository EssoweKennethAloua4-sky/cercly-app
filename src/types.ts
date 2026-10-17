export type Locale = 'fr' | 'en'

export interface GroupInfo {
  id: string
  name: string
  type: string
  currency: string
  period: string
  visibility: string
  loan_decision_mode: string
  expected_amount?: number | null
  initial_amount?: number | null
  start_month?: string | null
}

export interface Membership {
  group_id: string
  user_id: string
  display_name: string
  is_president: boolean
  can_validate: boolean
  can_publish: boolean
  status: string
}

export interface MyGroup extends Membership {
  group: GroupInfo
}

export interface Announcement {
  id: string
  author_id: string
  title: string
  body: string
  created_at: string
}

export interface ProofFile {
  id: string
  storage_path: string
  mime_type: string
}

export type ContributionStatus = 'en_attente' | 'validee' | 'rejetee'

export interface Contribution {
  id: string
  payer_id: string
  for_user_id: string
  amount: number
  paid_on: string
  note: string | null
  status: ContributionStatus
  reject_reason: string | null
  created_at: string
  contribution_files?: ProofFile[]
}

export interface AppNotification {
  id: string
  group_id: string
  kind: string
  details: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export interface MemberTotal {
  user_id: string
  display_name: string
  validated: number
  pending: number
}

export type ModuleName = 'annonces' | 'cotisations' | 'rappels' | 'prets'
export type GroupModules = Record<ModuleName, boolean>

export type LoanStatus = 'a_examiner' | 'garant_refuse' | 'en_vote' | 'validee' | 'refusee' | 'remboursee' | 'annulee'

export interface Loan {
  id: string
  link_member_id: string
  borrower_member_id: string | null
  guarantor_name: string
  guarantor_member_id: string | null
  guarantor_check: 'lien' | 'autre_membre' | 'inconnu' | 'corrige'
  guarantor_response: 'en_attente' | 'confirme' | 'refuse'
  amount: number
  due_date: string
  status: LoanStatus
  closes_at: string | null
  decided_at: string | null
  decision_basis: 'majorite' | 'egalite' | 'sans_quorum' | null
  dismiss_reason: string | null
  created_at: string
}

export interface LoanBorrower {
  loan_id: string
  name: string
  phone: string
  reason: string | null
}
