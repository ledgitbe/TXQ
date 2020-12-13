import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { path } from './../index';
import { sendResponseWrapper } from '../../../util/sendResponseWrapper';
import GetTxsByChannel from '../../../services/use_cases/tx/GetTxsByChannel';
import ResourceNotFoundError from '../../../services/error/ResourceNotFoundError';
import { sendErrorWrapper } from '../../../util/sendErrorWrapper';
import { AccountContextHelper } from '../../account-context-helper';
import AccessForbiddenError from '../../../services/error/AccessForbiddenError';
import { ChannelHelper } from '../../../services/helpers/ChannelHelper';
import InvalidAddressError from '../../../services/error/InvalidAddressError';
import InvalidScriptHashOrTXIDError from '../../../services/error/InvalidScriptHashOrTXIDError';
import { QueryOrderType } from '../../../interfaces/IQueryOrder';

export default [
  {
    path: `${path}/channel`,
    method: 'get',
    handler: [
      async (Req: Request, res: Response, next: NextFunction) => {
        try {
          let uc = Container.get(GetTxsByChannel);
          let data = await uc.run({
            channel: '',
            id: Req.query.id ? Req.query.id : 0,
            // tags: Req.query.tags,
            limit: Req.query.limit ? Req.query.limit : 1000,
            rawtx: Req.query.rawtx === '1' ? true : false,
            status: Req.query.status || 'all',
            order: ChannelHelper.getOrderMode(Req.query.order),
            accountContext: AccountContextHelper.getContext(Req),
            addresses: ChannelHelper.checkAddresses(
              ChannelHelper.getParamStringArray(
                (Req.query.address as string | string[]) || [],
              ),
            ),
            scripthashes: ChannelHelper.checkScriptHashesOrTXIDs(
              ChannelHelper.getParamStringArray(
                (Req.query.scripthash as string | string[]) || [],
              ),
            ),
            txids: ChannelHelper.checkScriptHashesOrTXIDs(
              ChannelHelper.getParamStringArray(
                (Req.query.txid as string | string[]) || [],
              ),
            ),
          });
          sendResponseWrapper(Req, res, 200, data.result);
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            sendErrorWrapper(res, 404, error.toString());
            return;
          } else if (error instanceof AccessForbiddenError) {
            sendErrorWrapper(res, 403, error.toString());
            return;
          } else if (error instanceof InvalidAddressError || error instanceof InvalidScriptHashOrTXIDError) {
            sendErrorWrapper(res, 400, error.toString());
            return;
          }
          next(error);
        }
      },
    ],
  },
  {
    path: `${path}/channel/:channel`,
    method: 'get',
    handler: [
      async (Req: Request, res: Response, next: NextFunction) => {
        try {
          let uc = Container.get(GetTxsByChannel);
          let data = await uc.run({
            channel: Req.params.channel,
            id: Req.query.id ? Req.query.id : 0,
            // tags: Req.query.tags,
            limit: Req.query.limit ? Req.query.limit : 1000,
            rawtx: Req.query.rawtx === '1' ? true : false,
            status: Req.query.status || 'all',
            order: ChannelHelper.getOrderMode(Req.query.order),
            accountContext: AccountContextHelper.getContext(Req),
            addresses: ChannelHelper.checkAddresses(
              ChannelHelper.getParamStringArray(
                (Req.query.address as string | string[]) || [],
              ),
            ),
            scripthashes: ChannelHelper.checkScriptHashesOrTXIDs(
              ChannelHelper.getParamStringArray(
                (Req.query.scripthash as string | string[]) || [],
              ),
            ),
            txids: ChannelHelper.checkScriptHashesOrTXIDs(
              ChannelHelper.getParamStringArray(
                (Req.query.txid as string | string[]) || [],
              ),
            ),
          });
          sendResponseWrapper(Req, res, 200, data.result);
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            sendErrorWrapper(res, 404, error.toString());
            return;
          } else if (error instanceof AccessForbiddenError) {
            sendErrorWrapper(res, 403, error.toString());
            return;
          } else if (error instanceof InvalidAddressError || error instanceof InvalidScriptHashOrTXIDError) {
            sendErrorWrapper(res, 400, error.toString());
            return;
          }
          next(error);
        }
      },
    ],
  },
  /*{
    path: `${path}/tags/:tags`,
    method: 'get',
    handler: [
      async (Req: Request, res: Response, next: NextFunction) => {
        try {
          let uc = Container.get(GetTxsByTags);
          let data = await uc.run({
            id: Req.query.id ? Req.query.id : 0,
            tags: Req.params.tags,
            limit: Req.query.limit ? Req.query.limit : 1000,
            rawtx: Req.query.rawtx === '1' ? true : false,
            accountContext: AccountContextHelper.getContext(Req)
          });
          sendResponseWrapper(Req, res, 200, data.result);
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            sendErrorWrapper(res, 404, error.toString());
            return;
          } else if (error instanceof AccessForbiddenError) {
            sendErrorWrapper(res, 403, error.toString());
            return;
          }
          next(error);
        }
      },
    ],
  }*/
];
