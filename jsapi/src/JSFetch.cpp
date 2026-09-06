// Copyright (C) 2025 Bilibili miniapp contributors
//
// This file is part of miniapp.
//
// miniapp is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// miniapp is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with miniapp. If not, see <https://www.gnu.org/licenses/>.

#include "JSFetch.hpp"

#include "Exceptions/AssertFailed.hpp"
#include "Fetch.hpp"

void JSFetch::fetch(JQAsyncInfo &info)
{
    try
    {
        ASSERT(info.Length() == 1);
        ASSERT(info[0].is_object());
        const Bson &opts = info[0];

        std::string url = opts["url"].string_value();
        ASSERT(!url.empty());

        std::string method = opts["method"].string_value();
        if (method.empty())
            method = "GET";

        std::unordered_map<std::string, std::string> headers;
        const Bson &headersVal = opts["headers"];
        if (headersVal.is_object())
        {
            for (const auto &kv : headersVal.object_items())
                headers[kv.first] = kv.second.string_value();
        }

        std::string body = opts["body"].string_value();

        size_t timeoutSec = 10;
        const Bson &timeoutVal = opts["timeout"];
        if (timeoutVal.is_number() && timeoutVal.number_value() > 0)
        {
            double timeoutMs = timeoutVal.number_value();
            timeoutSec = static_cast<size_t>((timeoutMs + 999.0) / 1000.0);
        }

        FetchOptions options(method, headers, body, false, nullptr, timeoutSec);
        Response response = Fetch::fetch(url, options);

        Bson::object headersObj;
        for (const auto &kv : response.headers)
            headersObj[kv.first] = kv.second;

        info.post(Bson::object{
            {"status", response.status},
            {"ok", response.ok},
            {"headers", headersObj},
            {"body", response.body}});
    }
    catch (const std::exception &e)
    {
        info.postError(e.what());
    }
}

extern JSValue createJSFetch(JQModuleEnv *env)
{
    JQFunctionTemplateRef tpl = JQFunctionTemplate::New(env, "Fetch");
    tpl->InstanceTemplate()->setObjectCreator([]()
                                              { return new JSFetch(); });
    tpl->SetProtoMethodPromise("fetch", &JSFetch::fetch);
    return tpl->CallConstructor();
}
