import { BaseFlowAdapter } from './base-adapter.js';
export class LegacyFlowAdapter extends BaseFlowAdapter {
    name = 'supply-chain-legacy';
    type = 'legacy';
    context;
    state = 'DRAFT';
    businessData = {};
    constructor(context) {
        super();
        this.context = context;
    }
    async initialize() {
        console.log(`[Legacy] Initializing adapter for project ${this.context.projectId}`);
        console.log(`[Legacy] Process: ${this.context.processId}`);
        this.state = 'DRAFT';
        this.businessData = {};
    }
    async cleanup() {
        super.cleanup();
        this.state = 'DRAFT';
        this.businessData = {};
    }
    async executeAction(action) {
        const startTime = new Date().toISOString();
        const input = this.context.config;
        const actionData = action.data;
        switch (action.type) {
            case 'SUBMIT':
                this.state = 'SUBMITTED';
                this.businessData = {
                    ...this.businessData,
                    submittedAt: startTime,
                    submittedBy: action.actor,
                    // Generic input fields
                    ...(input?.data || {}),
                    ...(actionData || {})
                };
                break;
            case 'APPROVE':
                if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
                    this.state = this.getNextState('APPROVE');
                    this.businessData = {
                        ...this.businessData,
                        approvedAt: startTime,
                        approver: action.actor,
                        approvalComment: actionData?.comment
                    };
                }
                else {
                    return this.createErrorResult(action, 'INVALID_STATE', `Cannot approve from state: ${this.state}`);
                }
                break;
            case 'REJECT':
                if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
                    this.state = 'REJECTED';
                    this.businessData = {
                        ...this.businessData,
                        rejectedAt: startTime,
                        rejector: action.actor,
                        rejectionReason: actionData?.reason,
                        finalStatus: 'REJECTED'
                    };
                }
                else {
                    return this.createErrorResult(action, 'INVALID_STATE', `Cannot reject from state: ${this.state}`);
                }
                break;
            case 'RETURN':
                if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
                    this.state = 'RETURNED';
                    this.businessData = {
                        ...this.businessData,
                        returnedAt: startTime,
                        returnedBy: action.actor,
                        returnReason: actionData?.reason
                    };
                }
                else {
                    return this.createErrorResult(action, 'INVALID_STATE', `Cannot return from state: ${this.state}`);
                }
                break;
            case 'WITHDRAW':
                if (this.state !== 'APPROVED' && this.state !== 'REJECTED') {
                    this.state = 'WITHDRAWN';
                    this.businessData = {
                        ...this.businessData,
                        withdrawnAt: startTime,
                        withdrawnBy: action.actor,
                        withdrawReason: actionData?.reason,
                        finalStatus: 'WITHDRAWN'
                    };
                }
                else {
                    return this.createErrorResult(action, 'INVALID_STATE', `Cannot withdraw from state: ${this.state}`);
                }
                break;
            case 'TRANSFER':
                if (this.state === 'APPROVED') {
                    this.state = 'TRANSFERRED';
                    this.businessData = {
                        ...this.businessData,
                        transferredAt: startTime,
                        transferredBy: action.actor,
                        finalStatus: 'TRANSFERRED'
                    };
                }
                else {
                    return this.createErrorResult(action, 'INVALID_STATE', `Cannot transfer from state: ${this.state}`);
                }
                break;
            case 'COUNTERSIGN':
                if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
                    this.state = 'COUNTERSIGNED';
                    this.businessData = {
                        ...this.businessData,
                        countersignedAt: startTime,
                        countersigner: action.actor,
                        countersignComment: actionData?.comment
                    };
                }
                else {
                    return this.createErrorResult(action, 'INVALID_STATE', `Cannot initiate countersign from state: ${this.state}`);
                }
                break;
            case 'COUNTERSIGN_COMPLETE':
                if (this.state === 'COUNTERSIGNED') {
                    this.state = 'COUNTERSIGN_COMPLETED';
                    this.businessData = {
                        ...this.businessData,
                        countersignCompletedAt: startTime,
                        countersignCompletedBy: action.actor
                    };
                }
                else {
                    return this.createErrorResult(action, 'INVALID_STATE', `Cannot complete countersign from state: ${this.state}`);
                }
                break;
            default:
                return this.createErrorResult(action, 'INVALID_ACTION', `Unknown action type: ${action.type}`);
        }
        const endTime = new Date().toISOString();
        return {
            scenarioId: `legacy-${this.state}`,
            adapter: 'legacy',
            actions: [action],
            startTime,
            endTime,
            finalState: this.state,
            semanticPath: [this.state],
            businessData: { ...this.businessData },
            metadata: {
                adapterName: this.name,
                processId: this.context.processId
            }
        };
    }
    getNextState(action) {
        const stateTransitions = {
            'SUBMITTED': { 'APPROVE': 'APPROVED' },
            'RESUBMITTED': { 'APPROVE': 'APPROVED' },
            'RETURNED': { 'APPROVE': 'APPROVED' },
            'COUNTERSIGN_COMPLETED': { 'APPROVE': 'APPROVED' },
        };
        return stateTransitions[this.state]?.[action] || `${this.state}_${action}`;
    }
    createErrorResult(action, errorCode, message) {
        return {
            scenarioId: `legacy-error-${errorCode}`,
            adapter: 'legacy',
            actions: [action],
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            finalState: `ERROR: ${this.state}`,
            semanticPath: [`ERROR: ${this.state}`],
            businessData: { ...this.businessData },
            error: `${errorCode}: ${message}`,
            metadata: {
                adapterName: this.name,
                processId: this.context.processId,
                actionError: message
            }
        };
    }
    async resetTestData() {
        this.state = 'DRAFT';
        this.businessData = {};
    }
}
//# sourceMappingURL=legacy-adapter.js.map