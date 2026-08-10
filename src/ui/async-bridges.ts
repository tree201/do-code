import type { ApprovalChoice, ToolApprovalRequest } from "../policy.js"
import type { PlanProposal, PlanReviewDecision } from "../tools.js"

export type ApprovalRequest = ToolApprovalRequest & { resolve: (choice: ApprovalChoice) => void }
export type UserQuestion = { question: string; options: string[]; resolve: (answer: string) => void }
export type PlanReviewRequest = { plan: PlanProposal; resolve: (decision: PlanReviewDecision) => void }

export class ApprovalBridge {
  private handler: ((request: ApprovalRequest) => void) | null = null

  attach(handler: ((request: ApprovalRequest) => void) | null) {
    this.handler = handler
  }

  async request(request: ToolApprovalRequest) {
    return await new Promise<ApprovalChoice>((resolve) => {
      if (!this.handler) return resolve("deny")
      this.handler({ ...request, resolve })
    })
  }
}

export class QuestionBridge {
  private handler: ((request: UserQuestion) => void) | null = null

  attach(handler: ((request: UserQuestion) => void) | null) {
    this.handler = handler
  }

  async request(question: string, options: string[] = []) {
    return await new Promise<string>((resolve) => {
      if (!this.handler) return resolve("User input is unavailable")
      this.handler({ question, options, resolve })
    })
  }
}

export class PlanReviewBridge {
  private handler: ((request: PlanReviewRequest) => void) | null = null

  attach(handler: ((request: PlanReviewRequest) => void) | null) {
    this.handler = handler
  }

  async request(plan: PlanProposal) {
    return await new Promise<PlanReviewDecision>((resolve) => {
      if (!this.handler) return resolve("cancel")
      this.handler({ plan, resolve })
    })
  }
}
