import { requireTenantScope } from './tenantScope.js';
import { completeDealAudit, decideDeal, getDealEvidence, listDealReview, requireReviewer, sampleDealAudit } from './dealReview.js';
import { dealEvidenceEnabled, issueDealMediaUrl, setDealEvidenceEnabled } from './media.js';

function respond(fn) {
  return (req,res,next) => {
    res.setHeader('Cache-Control','private, no-store');
    try { res.json(fn(req)); }
    catch (err) {
      if (err.status) res.status(err.status).json({ error: err.message, code: err.code });
      else next(err);
    }
  };
}

export function mountDealReview(api) {
  api.get('/deals/review',requireTenantScope,respond(req => {
    const tab = req.query.tab ?? 'review';
    const offset = Number(req.query.offset ?? 0);
    if (!['review','dp','audit','rejected'].includes(tab) || !Number.isSafeInteger(offset) || offset < 0) {
      throw Object.assign(Error('Antrean atau halaman tidak valid.'),{ status: 400 });
    }
    return {...listDealReview(req.tenantScope,tab,offset), proof_enabled:dealEvidenceEnabled(req.tenantScope.tenantId)};
  }));
  api.post('/deals/review/settings',requireTenantScope,respond(req => {
    requireReviewer(req.tenantScope);
    const enabled = req.body?.proof_enabled;
    if (typeof enabled !== 'boolean') {
      throw Object.assign(Error('Pilih aktif atau nonaktif untuk lampiran bukti.'),{status:400});
    }
    setDealEvidenceEnabled(req.tenantScope.tenantId,enabled);
    return {proof_enabled:enabled};
  }));
  api.post('/deals/:id/decision',requireTenantScope,respond(req => decideDeal.immediate(req.tenantScope,req.params.id,req.body)));
  api.post('/deals/:id/evidence/:messageId/url',requireTenantScope,respond(req => {
    const { message } = getDealEvidence(req.tenantScope,req.params.id,req.params.messageId);
    return issueDealMediaUrl(message.id,req.tenantScope);
  }));
  api.post('/deals/audit/sample',requireTenantScope,respond(req => sampleDealAudit.immediate(req.tenantScope)));
  api.post('/deals/:id/audit',requireTenantScope,respond(req => completeDealAudit.immediate(req.tenantScope,req.params.id,req.body)));
}
