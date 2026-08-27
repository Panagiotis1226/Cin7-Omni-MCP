#!/usr/bin/env python3
"""Generate a compact per-resource field reference (src/fieldReference.ts)
from Cin7 Omni's official swagger spec (https://api.cin7.com/api/swagger/v1/swagger.json)."""
import json, re
from collections import OrderedDict

d = json.load(open('swagger.json'))
schemas = d['components']['schemas']

def deref(node):
    if not isinstance(node, dict):
        return node
    if '$ref' in node:
        name = node['$ref'].split('/')[-1]
        return schemas.get(name, {})
    return node

def type_of(prop, depth=0):
    prop = deref(prop)
    t = prop.get('type')
    if t == 'array':
        item = deref(prop.get('items', {}))
        it = item.get('type')
        if it == 'object' or 'properties' in item:
            if depth >= 1:
                return 'object[]'
            inner = fields_of(item, depth + 1)
            return {'__array__': inner}
        return f"{it or 'object'}[]"
    if t == 'object' or 'properties' in prop:
        if 'properties' not in prop:
            return 'object'
        if depth >= 1:
            return 'object'
        return fields_of(prop, depth + 1)
    if 'enum' in prop:
        vals = prop['enum']
        if all(isinstance(v, str) for v in vals):
            return ' | '.join(vals[:12])
        return t or 'enum'
    fmt = prop.get('format')
    if t == 'string' and fmt == 'date-time':
        return 'datetime'
    if t == 'number' or (t == 'integer'):
        return t
    if t == 'string':
        return 'string'
    return t or 'object'

def fields_of(schema, depth=0):
    schema = deref(schema)
    out = OrderedDict()
    for name, prop in schema.get('properties', {}).items():
        out[name] = type_of(prop, depth)
    return out

def body_schema(op):
    rb = op.get('requestBody', {})
    content = rb.get('content', {})
    for mt in ('application/json', 'text/json', 'application/*+json'):
        if mt in content:
            return content[mt].get('schema', {})
    return None

def resp_schema(op):
    r = op.get('responses', {}).get('200', {})
    content = r.get('content', {})
    for mt in ('application/json', 'text/json'):
        if mt in content:
            return content[mt].get('schema', {})
    return None

resources = {}
for path, ops in d['paths'].items():
    m = re.match(r'^/api/(v[12])/([A-Za-z]+)', path)
    if not m:
        continue
    ver, res = m.groups()
    key = res if ver == 'v1' else f'{res}_{ver}'
    entry = resources.setdefault(key, {})
    for verb, op in ops.items():
        if verb not in ('get', 'post', 'put', 'delete'):
            continue
        if verb == 'get':
            s = resp_schema(op)
            if s is not None and 'responseFields' not in entry:
                s2 = deref(s)
                if s2.get('type') == 'array':
                    s2 = deref(s2.get('items', {}))
                f = fields_of(s2)
                if f:
                    entry['responseFields'] = f
        elif verb in ('post', 'put'):
            s = body_schema(op)
            if s is not None:
                s2 = deref(s)
                if s2.get('type') == 'array':
                    s2 = deref(s2.get('items', {}))
                f = fields_of(s2)
                if f:
                    entry.setdefault('writeFields', {})[verb.upper()] = f

# Drop write-field maps identical to the response shape (same swagger model)
for entry in resources.values():
    resp = entry.get('responseFields')
    wf = entry.get('writeFields')
    if resp and wf:
        for verb in list(wf):
            if wf[verb] == resp:
                del wf[verb]
        if not wf:
            del entry['writeFields']

# Sub-path resources like PaymentFeesAndPayouts/Fees
for path, ops in d['paths'].items():
    m = re.match(r'^/api/v1/(PaymentFeesAndPayouts)/(Fees|Payouts)$', path)
    if m:
        op = ops.get('get')
        if op:
            s = resp_schema(op)
            if s is not None:
                s2 = deref(s)
                if s2.get('type') == 'array':
                    s2 = deref(s2.get('items', {}))
                resources.setdefault('PaymentFeesAndPayouts', {})['responseFields'] = fields_of(s2)

out_lines = [
    '// AUTO-GENERATED from Cin7 Omni official swagger spec',
    '// (https://api.cin7.com/api/swagger/v1/swagger.json). Do not edit by hand;',
    '// regenerate with scripts/gen_fields.py if Cin7 updates their API.',
    '',
    '/** Field name -> type string, or nested object for one level of structure. */',
    'export type FieldMap = { [field: string]: unknown };',
    '',
    'export interface ResourceFields {',
    '  /** Fields returned by GET (list & by-id). */',
    '  responseFields?: FieldMap;',
    '  /** Request-body fields accepted by POST / PUT, when they differ from the response shape. */',
    '  writeFields?: { POST?: FieldMap; PUT?: FieldMap };',
    '}',
    '',
    'export const FIELD_REFERENCE: { [resource: string]: ResourceFields } = ' +
    json.dumps(resources, indent=2) + ';',
    ''
]
open('fieldReference.ts', 'w').write('\n'.join(out_lines))
print('resources:', ', '.join(sorted(resources)))
print('size:', len('\n'.join(out_lines)), 'chars')
